// Garam Setup — kucuk indirici kurulum programi.
//
// Yaptigi is:
//   1. catalog.json'u indirir (uygulama listesi + surum + sha256)
//   2. Kullanicinin sectigi kurulumlari indirir, ilerlemeyi arayuze bildirir
//   3. SHA-256 dogrular — eslesmezse KURMAZ
//   4. NSIS kurulumunu sessiz (/S) calistirir ve cikis kodunu bekler
//
// Kurulum dosyalari uygulamanin kendi icine gomulmez; bu yuzden setup birkac
// MB kalir ve yeni uygulama eklemek icin setup'i yeniden yayinlamak gerekmez.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

/// catalog.json'un varsayilan adresi.
///
/// Derleme sirasinda GARAM_CATALOG_URL ortam degiskeniyle ezilir. `env!` yerine
/// `option_env!` kullaniliyor ki degisken tanimli degilken de proje derlensin —
/// aksi halde depoyu klonlayan herkesin once degiskeni ayarlamasi gerekirdi.
const DEFAULT_CATALOG_URL: &str = match option_env!("GARAM_CATALOG_URL") {
    Some(url) => url,
    None => "https://GARAM_GITHUB_KULLANICI_ADI.github.io/garam-apps/catalog.json",
};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Catalog {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    apps: Vec<AppEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppEntry {
    id: String,
    name: String,
    description: String,
    version: String,
    #[serde(rename = "sizeBytes")]
    size_bytes: u64,
    #[serde(default)]
    default: bool,
    installer: Installer,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Installer {
    #[serde(rename = "fileName")]
    file_name: String,
    url: String,
    sha256: String,
    #[serde(rename = "silentArgs")]
    silent_args: Vec<String>,
}

/// Arayuze yayinlanan ilerleme olayi.
#[derive(Debug, Clone, Serialize)]
struct Progress {
    app_id: String,
    /// "downloading" | "verifying" | "installing" | "done" | "error"
    phase: String,
    /// 0.0 - 1.0; bilinmiyorsa -1.
    ratio: f64,
    message: String,
}

fn emit(window: &tauri::Window, progress: Progress) {
    // Arayuz kapanmis olabilir; yayin hatasi kurulumu durdurmamali.
    let _ = window.emit("install-progress", progress);
}

#[tauri::command]
async fn fetch_catalog(url: Option<String>) -> Result<Catalog, String> {
    let url = url.unwrap_or_else(|| DEFAULT_CATALOG_URL.to_string());

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Katalog indirilemedi: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Katalog sunucusu {} dondu ({url})",
            response.status()
        ));
    }

    let catalog: Catalog = response
        .json()
        .await
        .map_err(|e| format!("Katalog cozumlenemedi: {e}"))?;

    if catalog.schema_version != 1 {
        return Err(format!(
            "Bu kurulum programi katalog surumu {}'i desteklemiyor. Guncel setup'i indirin.",
            catalog.schema_version
        ));
    }

    Ok(catalog)
}

/// Secilen uygulamalari sirayla indirir, dogrular ve kurar.
#[tauri::command]
async fn install_apps(
    window: tauri::Window,
    apps: Vec<AppEntry>,
    install_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let temp_dir = std::env::temp_dir().join("garam-setup");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Gecici klasor olusturulamadi: {e}"))?;

    let mut installed = Vec::new();

    for app in apps {
        let target = temp_dir.join(&app.installer.file_name);

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "downloading".into(),
                ratio: 0.0,
                message: format!("{} indiriliyor...", app.name),
            },
        );

        download(&window, &app, &target).await?;

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "verifying".into(),
                ratio: -1.0,
                message: "Dosya dogrulaniyor...".into(),
            },
        );

        let actual = sha256_file(&target).map_err(|e| format!("Dogrulama okunamadi: {e}"))?;
        if !actual.eq_ignore_ascii_case(&app.installer.sha256) {
            // Bozuk veya degistirilmis dosyayi CALISTIRMA.
            let _ = std::fs::remove_file(&target);
            return Err(format!(
                "{}: dosya dogrulanamadi. Indirme bozulmus olabilir; kurulum durduruldu.",
                app.name
            ));
        }

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "installing".into(),
                ratio: -1.0,
                message: format!("{} kuruluyor...", app.name),
            },
        );

        run_installer(&target, &app.installer.silent_args, install_dir.as_deref())
            .map_err(|e| format!("{}: {e}", app.name))?;

        let _ = std::fs::remove_file(&target);

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "done".into(),
                ratio: 1.0,
                message: format!("{} kuruldu", app.name),
            },
        );

        installed.push(app.id);
    }

    Ok(installed)
}

/// Dosyayi akitarak indirir ve her parcada ilerleme yayinlar.
async fn download(window: &tauri::Window, app: &AppEntry, target: &Path) -> Result<(), String> {
    let response = reqwest::get(&app.installer.url)
        .await
        .map_err(|e| format!("{}: baglanti kurulamadi ({e})", app.name))?;

    if !response.status().is_success() {
        return Err(format!(
            "{}: sunucu {} dondu",
            app.name,
            response.status()
        ));
    }

    // Content-Length yoksa katalogdaki boyutu kullan; o da yoksa oransiz goster.
    let total = response.content_length().unwrap_or(app.size_bytes);

    let mut file = std::fs::File::create(target)
        .map_err(|e| format!("{}: dosya olusturulamadi ({e})", app.name))?;

    let mut downloaded: u64 = 0;
    let mut last_emit = 0u64;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("{}: indirme kesildi ({e})", app.name))?;
        file.write_all(&chunk)
            .map_err(|e| format!("{}: diske yazilamadi ({e})", app.name))?;

        downloaded += chunk.len() as u64;

        // Her parcada olay yayinlamak arayuzu bogar; ~1 MB'de bir yeter.
        if downloaded - last_emit > 1_048_576 || downloaded == total {
            last_emit = downloaded;
            emit(
                window,
                Progress {
                    app_id: app.id.clone(),
                    phase: "downloading".into(),
                    ratio: if total > 0 {
                        downloaded as f64 / total as f64
                    } else {
                        -1.0
                    },
                    message: format!(
                        "{} indiriliyor  {:.1} / {:.1} MB",
                        app.name,
                        downloaded as f64 / 1_048_576.0,
                        total as f64 / 1_048_576.0
                    ),
                },
            );
        }
    }

    file.flush()
        .map_err(|e| format!("{}: dosya kapatilamadi ({e})", app.name))?;

    Ok(())
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// NSIS kurulumunu sessiz calistirir ve bitmesini bekler.
fn run_installer(path: &Path, silent_args: &[String], install_dir: Option<&str>) -> Result<(), String> {
    let mut command = Command::new(path);
    command.args(silent_args);

    // electron-builder NSIS: /D=<yol> TIRNAKSIZ ve EN SON argüman olmali.
    if let Some(dir) = install_dir {
        if !dir.trim().is_empty() {
            command.arg(format!("/D={dir}"));
        }
    }

    let status = command
        .status()
        .map_err(|e| format!("kurulum baslatilamadi ({e})"))?;

    match status.code() {
        Some(0) => Ok(()),
        // NSIS 1223 = kullanici UAC istemini reddetti
        Some(1223) => Err("kurulum kullanici tarafindan iptal edildi".into()),
        Some(code) => Err(format!("kurulum {code} kodu ile basarisiz oldu")),
        None => Err("kurulum beklenmedik sekilde sonlandi".into()),
    }
}

/// Varsayilan kurulum klasoru — arayuzde gosterilir.
#[tauri::command]
fn default_install_dir() -> String {
    std::env::var("LOCALAPPDATA")
        .map(|p| PathBuf::from(p).join("Programs").to_string_lossy().into_owned())
        .unwrap_or_else(|_| String::from("C:\\Program Files"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fetch_catalog,
            install_apps,
            default_install_dir
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulamasi baslatilamadi");
}
