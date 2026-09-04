fn main() {
    // The manifest is what makes this setup run elevated; see app.manifest for
    // why that is not optional. Passing one replaces tauri-build's default, so
    // the file has to carry the DPI and supportedOS blocks too.
    let windows = tauri_build::WindowsAttributes::new()
        .app_manifest(include_str!("app.manifest"));

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
