// Garam Setup — a small downloader-style installer.
//
// What it does:
//   1. Downloads catalog.json (app list + version + sha256)
//   2. Downloads the installers the user picked, reporting progress to the UI
//   3. Verifies SHA-256 — a mismatch means it does NOT install
//   4. Runs the NSIS installer silently (/S) and waits for its exit code
//
// Installers are never embedded in this binary, so the setup stays a few MB
// and adding a new app does not require republishing the setup.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::path::Path;
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
    None => "https://raw.githubusercontent.com/Garamisericorde/garam-apps/main/catalog.json",
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

#[tauri::command]
async fn fetch_catalog(url: Option<String>) -> Result<Catalog, String> {
    let url = url.unwrap_or_else(|| DEFAULT_CATALOG_URL.to_string());

    let response = reqwest::get(&url)
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

    if catalog.schema_version != 1 {
        return Err(format!(
            "This setup does not support catalog version {}. Download the latest setup.",
            catalog.schema_version
        ));
    }

    Ok(catalog)
}

/// Downloads, verifies and installs the selected apps one after another.
#[tauri::command]
async fn install_apps(window: tauri::Window, apps: Vec<AppEntry>) -> Result<Vec<String>, String> {
    let temp_dir = std::env::temp_dir().join("garam-setup");
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

        run_installer(&target, &app.installer.silent_args)
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
    let response = reqwest::get(&app.installer.url)
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
        Some(0) => Ok(()),
        // NSIS 1223 = the user declined the UAC prompt
        Some(1223) => Err("the install was cancelled by the user".into()),
        Some(code) => Err(format!("the installer failed with exit code {code}")),
        None => Err("the installer terminated unexpectedly".into()),
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![fetch_catalog, install_apps])
        .run(tauri::generate_context!())
        .expect("failed to start the Tauri application");
}
