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

#[derive(Debug, Default, Serialize)]
struct InstallReport {
    installed: Vec<String>,
    failed: Vec<InstallFailure>,
}

#[derive(Debug, Serialize)]
struct InstallFailure {
    app_id: String,
    name: String,
    message: String,
}

// Attempt independent apps first. Network changes require earlier success.
async fn install_batch<F, Fut, N>(mut apps: Vec<AppEntry>, mut install: F, mut notify: N) -> InstallReport
where
    F: FnMut(AppEntry) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
    N: FnMut(&AppEntry, &Result<(), String>),
{
    apps.sort_by_key(|app| app.id == "g-dpi");
    let mut report = InstallReport::default();
    for app in apps {
        let result = if app.id == "g-dpi" && !report.failed.is_empty() {
            Err("G-DPI was not changed because another selected app failed. Retry after fixing that failure.".into())
        } else { install(app.clone()).await };
        notify(&app, &result);
        match result {
            Ok(()) => report.installed.push(app.id),
            Err(message) => report.failed.push(InstallFailure { app_id: app.id, name: app.name, message }),
        }
    }
    report
}

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
async fn install_apps(window: tauri::Window, ids: Vec<String>, dpi_profile: String, state: tauri::State<'_, SetupState>) -> Result<InstallReport, String> {
    {
        let mut busy = state.busy.lock().map_err(|_| "Setup state unavailable")?;
        if *busy { return Err("Installation already running".into()); }
        *busy = true;
    }
    let result = install_selected(&window, ids, &dpi_profile, &state).await;
    if let Ok(mut busy) = state.busy.lock() { *busy = false; }
    result
}

async fn install_selected(window: &tauri::Window, ids: Vec<String>, dpi_profile: &str, state: &SetupState) -> Result<InstallReport, String> {
    let catalog = state.catalog.lock().map_err(|_| "Catalog state unavailable")?.clone().ok_or("Fetch the catalog first")?;
    let mut apps = Vec::new();
    for id in ids {
        if apps.iter().any(|app: &AppEntry| app.id == id) { continue; }
        apps.push(catalog.apps.iter().find(|app| app.id == id).ok_or("Unknown application")?.clone());
    }
    let preserve_dpi = if apps.iter().any(|app| app.id == "g-dpi") {
        let existing = gdpi_installed()?;
        configure_dpi_choice(&mut apps, dpi_profile, existing)?
    } else { false };
    let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let temp_dir = std::env::temp_dir().join(format!("garam-setup-{}-{unique}", std::process::id()));
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Could not create the temp folder: {e}"))?;

    let directory = &temp_dir;
    // No installer runs until every selected package has downloaded and verified.
    let prepared = install_batch(apps.clone(), |app| async move {
        prepare_one(window, &app, directory).await
    }, |app, result| {
        if let Err(message) = result {
            emit(window, Progress { app_id: app.id.clone(), phase: "error".into(), ratio: 1.0, message: message.clone() });
        }
    }).await;
    let mut report = if !prepared.failed.is_empty() {
        let mut failed = prepared.failed;
        for app in &apps {
            if !failed.iter().any(|failure| failure.app_id == app.id) {
                let message = "Not installed: another selected package could not be downloaded or verified. No installers were run.".to_string();
                emit(window, Progress { app_id: app.id.clone(), phase: "error".into(), ratio: 1.0, message: message.clone() });
                failed.push(InstallFailure { app_id: app.id.clone(), name: app.name.clone(), message });
            }
        }
        InstallReport { installed: vec![], failed }
    } else {
        install_batch(apps, |app| async move {
            emit(window, Progress { app_id: app.id.clone(), phase: "installing".into(), ratio: -1.0, message: format!("Installing {}...", app.name) });
            run_package(&directory.join(&app.installer.file_name), &app.installer, directory, &app.id)
        }, |app, result| {
            emit(window, Progress {
                app_id: app.id.clone(), phase: if result.is_ok() { "done" } else { "error" }.into(), ratio: 1.0,
                message: match result { Ok(()) => format!("{} installed", app.name), Err(message) => message.clone() },
            });
        }).await
    };
    if preserve_dpi {
        report.installed.push("g-dpi".into());
        emit(window, Progress { app_id: "g-dpi".into(), phase: "done".into(), ratio: 1.0, message: "Existing G-DPI service and profile preserved".into() });
    }
    // All child installers have exited. Failed downloads and extracted scripts
    // are no longer needed either.
    let _ = std::fs::remove_dir_all(&temp_dir);
    Ok(report)
}

async fn prepare_one(window: &tauri::Window, app: &AppEntry, temp_dir: &Path) -> Result<(), String> {
    let target = temp_dir.join(&app.installer.file_name);

    emit(
        window,
        Progress {
            app_id: app.id.clone(),
            phase: "downloading".into(),
            ratio: 0.0,
            message: format!("Downloading {}...", app.name),
        },
    );

    download(window, app, &target).await?;

    emit(
        window,
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
            "{}: checksum did not match. The download may be corrupt; this app was not installed.",
            app.name
        ));
    }

    Ok(())
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

fn gdpi_installed() -> Result<bool, String> {
    let windows = std::env::var_os("SystemRoot").ok_or("Windows directory unavailable")?;
    let mut command = Command::new(Path::new(&windows).join("System32/sc.exe"));
    command.args(["query", "G-DPI"]);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|e| format!("Could not inspect existing G-DPI: {e}"))?;
    match output.status.code() {
        Some(0) => Ok(true),
        Some(1060) => Ok(false),
        _ => Err("Could not inspect G-DPI safely. It was left unchanged.".into()),
    }
}

fn configure_dpi_choice(apps: &mut Vec<AppEntry>, profile: &str, existing: bool) -> Result<bool, String> {
    if existing {
        apps.retain(|app| app.id != "g-dpi");
        return Ok(true);
    }
    if !matches!(profile, "superonline" | "vodafone-zapret") {
        return Err("G-DPI is not installed. Choose Superonline or Vodafone before installing. No changes were made.".into());
    }
    if let Some(app) = apps.iter_mut().find(|app| app.id == "g-dpi") {
        let version: Vec<u32> = app.version.split('.').map(|part| part.parse().unwrap_or(0)).collect();
        if version.as_slice() < [0, 1, 5].as_slice() {
            return Err("The catalog contains an old G-DPI package. Refresh the catalog before installing.".into());
        }
        app.installer.silent_args = vec!["-Profile".into(), profile.into()];
    }
    Ok(false)
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

fn run_package(path: &Path, installer: &Installer, temp_dir: &Path, app_id: &str) -> Result<(), String> {
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
    command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(&entry).args(&installer.silent_args);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let output = command.output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        let failure = script_failure(&String::from_utf8_lossy(&output.stdout), &String::from_utf8_lossy(&output.stderr));
        if app_id == "g-dpi" {
            // Existing services were excluded before preparing the install plan.
            // A failed fresh install must undo its own service and DNS policy.
            let removal = entry.parent().ok_or("Missing service directory")?.join("manage.ps1");
            let mut rollback = Command::new(Path::new(&windows).join("System32/WindowsPowerShell/v1.0/powershell.exe"));
            rollback.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(removal).args(["-Action", "remove"]);
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                rollback.creation_flags(0x08000000);
            }
            match rollback.output() {
                Ok(result) if result.status.success() => return Err(format!("{failure}\nThe failed new G-DPI installation was removed and its DNS changes were restored.")),
                _ => return Err(format!("{failure}\nAutomatic cleanup could not be confirmed. Run service_remove.bat from the G-DPI package as administrator.")),
            }
        }
        return Err(failure);
    }
    let _ = std::fs::remove_dir_all(&extraction);
    Ok(())
}

fn script_failure(stdout: &str, stderr: &str) -> String {
    // Also recognize the message from already-published G-DPI packages.
    let output = format!("{stdout}\n{stderr}");
    let normalized = output.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.contains("Remove the existing GoodbyeDPI service using its own removal script first.") {
        return "An existing GoodbyeDPI service is installed (it may be stopped). To use G-DPI, remove that service with the original GoodbyeDPI removal script as administrator, then retry G-DPI. You can also leave G-DPI unchecked and keep using your existing service.".into();
    }
    format!("Script installation failed: {}", output.trim())
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

    fn app(id: &str) -> AppEntry {
        AppEntry {
            id: id.into(), name: id.into(), description: String::new(), version: "1.0.0".into(),
            size_bytes: 0, default: false,
            installer: Installer { kind: "exe".into(), entry_point: None, file_name: "setup.exe".into(),
                url: String::new(), sha256: String::new(), silent_args: vec![] },
        }
    }

    #[test]
    fn goodbye_dpi_failure_does_not_block_snap() {
        use futures_util::FutureExt;
        let mut attempted = Vec::new();
        let mut events = Vec::new();
        let report = install_batch(vec![app("g-dpi"), app("g-snap")], |app| {
            attempted.push(app.id.clone());
            async move {
                if app.id == "g-dpi" { Err("GoodbyeDPI conflict".into()) } else { Ok(()) }
            }
        }, |app, result| events.push((app.id.clone(), result.is_ok())))
            .now_or_never().expect("fixture futures complete immediately");
        assert_eq!(attempted, ["g-snap", "g-dpi"]);
        assert_eq!(events, [("g-snap".into(), true), ("g-dpi".into(), false)]);
        assert_eq!(report.installed, ["g-snap"]);
        assert_eq!(report.failed.len(), 1);
        assert_eq!(report.failed[0].app_id, "g-dpi");
        assert_eq!(report.failed[0].message, "GoodbyeDPI conflict");
    }

    #[test]
    fn batch_reports_all_successes_and_all_failures() {
        use futures_util::FutureExt;
        let apps = vec![app("g-dpi"), app("g-snap")];
        let successful = install_batch(apps.clone(), |_| async { Ok(()) }, |_, _| {})
            .now_or_never().unwrap();
        assert_eq!(successful.installed, ["g-snap", "g-dpi"]);
        assert!(successful.failed.is_empty());
        let failed = install_batch(apps, |_| async { Err("failed".into()) }, |_, _| {})
            .now_or_never().unwrap();
        assert!(failed.installed.is_empty());
        assert_eq!(failed.failed.iter().map(|f| f.app_id.as_str()).collect::<Vec<_>>(), ["g-snap", "g-dpi"]);
    }

    #[test]
    fn published_goodbye_dpi_error_has_actionable_message() {
        let message = script_failure("", "C:\\Temp\\install.ps1 : Remove the existing GoodbyeDPI service using its own\r\nremoval script first.\nAt line:29");
        assert!(message.contains("original GoodbyeDPI removal script as administrator"));
        assert!(message.contains("leave G-DPI unchecked"));
        assert!(!message.contains("C:\\Temp"));
        assert!(script_failure("", "Engine integrity check failed").contains("Engine integrity check failed"));
    }
    #[test]
    fn existing_dpi_is_removed_from_the_install_plan() {
        let mut apps = vec![app("g-dpi"), app("g-presets")];
        assert!(configure_dpi_choice(&mut apps, "superonline", true).unwrap());
        assert_eq!(apps.iter().map(|app| app.id.as_str()).collect::<Vec<_>>(), ["g-presets"]);
    }
    #[test]
    fn fresh_dpi_requires_explicit_provider_and_overrides_catalog_args() {
        let mut apps = vec![app("g-dpi")];
        assert!(configure_dpi_choice(&mut apps, "keep", false).is_err());
        apps[0].version = "0.1.5".into();
        apps[0].installer.silent_args = vec!["-Profile".into(), "superonline".into()];
        assert!(!configure_dpi_choice(&mut apps, "vodafone-zapret", false).unwrap());
        assert_eq!(apps[0].installer.silent_args, ["-Profile", "vodafone-zapret"]);
    }
    #[test]
    fn installer_failure_never_runs_dpi() {
        use futures_util::FutureExt;
        let mut attempted = Vec::new();
        let result = install_batch(vec![app("g-dpi"), app("g-presets")], |app| {
            attempted.push(app.id);
            async { Err("failed".into()) }
        }, |_, _| {}).now_or_never().unwrap();
        assert_eq!(attempted, ["g-presets"]);
        assert_eq!(result.failed.len(), 2);
    }
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
