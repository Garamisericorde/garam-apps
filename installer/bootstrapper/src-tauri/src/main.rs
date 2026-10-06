// Garam Setup — a small downloader-style installer.
//
// What it does:
//   1. Downloads catalog.json (app list + version + sha256)
//   2. Downloads the installers the user picked, reporting progress to the UI
//   3. Verifies SHA-256 — a mismatch means it does NOT install
//   4. Runs the EXE or extracted PowerShell installer and checks its exit code
//
// Installers are never embedded in this binary, so the setup stays a few MB
// and adding a new app does not require republishing the setup.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::{Path, Component};
use std::sync::Mutex;
use std::process::Command;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Default catalog.json URL.
///
/// Overridden at build time with the GARAM_CATALOG_URL environment variable.
/// `option_env!` is used rather than `env!` so the project still compiles when
/// the variable is unset — otherwise every fresh clone would fail to build.
const DEFAULT_CATALOG_URL: &str = match option_env!("GARAM_CATALOG_URL") {
    Some(url) => url,
    None => "https://github.com/Garamisericorde/garam-apps/releases/download/catalog/catalog.json",
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
    kind: String,
    #[serde(rename = "entryPoint")]
    entry_point: Option<String>,
    #[serde(rename = "fileName")]
    file_name: String,
    url: String,
    sha256: String,
    #[serde(rename = "silentArgs")]
    silent_args: Vec<String>,
}

/// Progress event emitted to the UI.
#[derive(Debug, Clone, Serialize)]
struct Progress {
    app_id: String,
    /// "downloading" | "verifying" | "installing" | "done" | "error"
    phase: String,
    /// 0.0 - 1.0, or -1 when unknown.
    ratio: f64,
    message: String,
}

fn emit(window: &tauri::Window, progress: Progress) {
    // The UI may have closed; a failed emit must not stop the install.
    let _ = window.emit("install-progress", progress);
}

struct SetupState { catalog: Mutex<Option<Catalog>>, busy: Mutex<bool> }

#[tauri::command]
async fn fetch_catalog(state: tauri::State<'_, SetupState>) -> Result<Catalog, String> {
    let url = DEFAULT_CATALOG_URL.to_string();

    let response = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(30)).timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?.get(&url).send()
        .await
        .map_err(|e| format!("Could not download the catalog: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Catalog server returned {} ({url})",
            response.status()
        ));
    }

    let catalog: Catalog = response
        .json()
        .await
        .map_err(|e| format!("Could not parse the catalog: {e}"))?;

    if catalog.schema_version != 2 {
        return Err(format!(
            "This setup does not support catalog version {}. Download the latest setup.",
            catalog.schema_version
        ));
    }

    for app in &catalog.apps { validate_installer(&app.installer)?; }
    *state.catalog.lock().map_err(|_| "Catalog state unavailable")? = Some(catalog.clone());
    Ok(catalog)
}

/// Downloads, verifies and installs the selected apps one after another.
#[tauri::command]
async fn install_apps(window: tauri::Window, ids: Vec<String>, state: tauri::State<'_, SetupState>) -> Result<Vec<String>, String> {
    {
        let mut busy = state.busy.lock().map_err(|_| "Setup state unavailable")?;
        if *busy { return Err("Installation already running".into()); }
        *busy = true;
    }
    let result = install_selected(&window, ids, &state).await;
    if let Ok(mut busy) = state.busy.lock() { *busy = false; }
    result
}

async fn install_selected(window: &tauri::Window, ids: Vec<String>, state: &SetupState) -> Result<Vec<String>, String> {
    let catalog = state.catalog.lock().map_err(|_| "Catalog state unavailable")?.clone().ok_or("Fetch the catalog first")?;
    let mut apps = Vec::new();
    for id in ids {
        if apps.iter().any(|app: &AppEntry| app.id == id) { continue; }
        apps.push(catalog.apps.iter().find(|app| app.id == id).ok_or("Unknown application")?.clone());
    }
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("garam-setup-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Could not create the temp folder: {e}"))?;

    let mut installed = Vec::new();

    for app in apps {
        let target = temp_dir.join(&app.installer.file_name);

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "downloading".into(),
                ratio: 0.0,
                message: format!("Downloading {}...", app.name),
            },
        );

        download(&window, &app, &target).await?;

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "verifying".into(),
                ratio: -1.0,
                message: "Verifying download...".into(),
            },
        );

        let actual = sha256_file(&target).map_err(|e| format!("Could not read the file to verify it: {e}"))?;
        if !actual.eq_ignore_ascii_case(&app.installer.sha256) {
            // NEVER run a corrupted or tampered installer.
            let _ = std::fs::remove_file(&target);
            return Err(format!(
                "{}: checksum did not match. The download may be corrupt; install stopped.",
                app.name
            ));
        }

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "installing".into(),
                ratio: -1.0,
                message: format!("Installing {}...", app.name),
            },
        );

        run_package(&target, &app.installer, &temp_dir)
            .map_err(|e| format!("{}: {e}", app.name))?;

        let _ = std::fs::remove_file(&target);

        emit(
            &window,
            Progress {
                app_id: app.id.clone(),
                phase: "done".into(),
                ratio: 1.0,
                message: format!("{} installed", app.name),
            },
        );

        installed.push(app.id);
    }

    Ok(installed)
}

/// Streams the download to disk, emitting progress as chunks arrive.
async fn download(window: &tauri::Window, app: &AppEntry, target: &Path) -> Result<(), String> {
    let response = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(30)).timeout(std::time::Duration::from_secs(1800)).build().map_err(|e| e.to_string())?.get(&app.installer.url).send()
        .await
        .map_err(|e| format!("{}: could not connect ({e})", app.name))?;

    if !response.status().is_success() {
        return Err(format!(
            "{}: server returned {}",
            app.name,
            response.status()
        ));
    }

    // Fall back to the catalog size when Content-Length is absent.
    let total = response.content_length().unwrap_or(app.size_bytes);

    let mut file = std::fs::File::create(target)
        .map_err(|e| format!("{}: could not create the file ({e})", app.name))?;

    let mut downloaded: u64 = 0;
    let mut last_emit = 0u64;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("{}: download interrupted ({e})", app.name))?;
        file.write_all(&chunk)
            .map_err(|e| format!("{}: could not write to disk ({e})", app.name))?;

        downloaded += chunk.len() as u64;

        // Emitting on every chunk floods the UI; about once per MB is plenty.
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
                        "Downloading {}  {:.1} / {:.1} MB",
                        app.name,
                        downloaded as f64 / 1_048_576.0,
                        total as f64 / 1_048_576.0
                    ),
                },
            );
        }
    }

    file.flush()
        .map_err(|e| format!("{}: could not close the file ({e})", app.name))?;

    Ok(())
}

fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

fn safe_relative(value: &str) -> bool {
    !value.is_empty() && !value.contains('\\') && !value.contains(':') &&
        Path::new(value).components().all(|part| matches!(part, Component::Normal(_)))
}

fn validate_installer(installer: &Installer) -> Result<(), String> {
    if !safe_relative(&installer.file_name) || installer.file_name.contains('/') {
        return Err("Invalid installer filename".into());
    }
    if !installer.url.starts_with("https://github.com/Garamisericorde/garam-apps/releases/download/") {
        return Err("Installer URL is outside the Garam release repository".into());
    }
    if installer.sha256.len() != 64 || !installer.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid installer checksum".into());
    }
    match installer.kind.as_str() {
        "exe" if installer.file_name.ends_with(".exe") => Ok(()),
        "zip-powershell" if installer.file_name.ends_with(".zip") => {
            let entry = installer.entry_point.as_deref().ok_or("Archive entry point missing")?;
            if safe_relative(entry) && entry.ends_with(".ps1") { Ok(()) } else { Err("Invalid archive entry point".into()) }
        },
        _ => Err("Unsupported installer format".into())
    }
}

fn run_package(path: &Path, installer: &Installer, temp_dir: &Path) -> Result<(), String> {
    if installer.kind == "exe" { return run_installer(path, &installer.silent_args); }
    let extraction = temp_dir.join(format!("{}-files", installer.file_name));
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if archive.len() > 10000 { return Err("Archive contains too many files".into()); }
    let mut size = 0u64;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        size = size.checked_add(file.size()).ok_or("Archive size overflow")?;
        if size > 512 * 1024 * 1024 { return Err("Archive exceeds extraction limit".into()); }
        if file.unix_mode().map(|mode| mode & 0o170000 == 0o120000).unwrap_or(false) { return Err("Archive symlinks are not supported".into()); }
        let relative = file.enclosed_name().ok_or("Archive path escapes destination")?;
        if !safe_relative(file.name().trim_end_matches('/')) { return Err("Unsafe archive path".into()); }
        let target = extraction.join(relative);
        if file.is_dir() { std::fs::create_dir_all(&target).map_err(|e| e.to_string())?; }
        else {
            if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            std::io::copy(&mut file, &mut std::fs::File::create(target).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
    }
    let entry = extraction.join(installer.entry_point.as_deref().ok_or("Missing script")?);
    if !entry.is_file() { return Err("Archive installation script was not found".into()); }
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command = Command::new(Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
    command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(entry).args(&installer.silent_args);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(format!("Script installation failed: {} {}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr))); }
    let _ = std::fs::remove_dir_all(&extraction);
    Ok(())
}

/// Runs the NSIS installer silently and waits for it to finish.
///
/// No install-directory override on purpose. Each app's installer already knows
/// where it belongs, and they no longer agree: g-snap is per-MACHINE (it needs
/// administrator to run at all, so it lives in Program Files) while the others
/// are per-user. Forcing one path on all three would put a per-machine app in
/// the local app data folder, which is the kind of thing that works until it
/// does not.
fn run_installer(path: &Path, silent_args: &[String]) -> Result<(), String> {
    let mut command = Command::new(path);
    command.args(silent_args);

    let status = command
        .status()
        .map_err(|e| format!("could not start the installer ({e})"))?;

    match status.code() {
        Some(0) | Some(3010) => Ok(()),
        // NSIS 1223 = the user declined the UAC prompt
        Some(1223) => Err("the install was cancelled by the user".into()),
        Some(code) => Err(format!("the installer failed with exit code {code}")),
        None => Err("the installer terminated unexpectedly".into()),
    }
}

fn main() {
    tauri::Builder::default()
        .manage(SetupState { catalog: Mutex::new(None), busy: Mutex::new(false) })
        .invoke_handler(tauri::generate_handler![fetch_catalog, install_apps])
        .run(tauri::generate_context!())
        .expect("failed to start the Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_escaping_paths() {
        for path in ["../evil.ps1", "/evil.ps1", "C:/evil.ps1", "folder\\evil.ps1", ""] { assert!(!safe_relative(path)); }
        assert!(safe_relative("G-DPI-0.1.0/service/install.ps1"));
    }
    #[test]
    fn rejects_untrusted_release_urls() {
        let installer = Installer { kind: "exe".into(), entry_point: None, file_name: "setup.exe".into(), url: "https://evil.example/setup.exe".into(), sha256: "a".repeat(64), silent_args: vec![] };
        assert!(validate_installer(&installer).is_err());
    }
}
