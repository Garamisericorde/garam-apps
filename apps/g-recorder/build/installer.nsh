; G-Recorder installer customisation.
;
; THE PROBLEM THIS SOLVES
;
; electron-builder's own "run after finish" is a checkbox on the installer's
; FINISH PAGE. Garam Setup installs silently (/S), and a silent NSIS install has
; no pages at all — so nothing ran, and nothing was going to.
;
; That one missing launch took the other two defaults with it. Launch-at-startup
; is a Run-key entry the APP writes on its first run, and the replay buffer is
; started by that same first run. No first run, no startup entry, no buffer:
; three settings that were all true in the file and false on the machine.
;
; Exec here runs in silent and interactive installs alike.

!macro customInstall
  ; Start the app as soon as it is installed. This first run is what registers
  ; launch-at-startup and starts the replay buffer.
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInit
  ; Stop the app BEFORE any files are removed, or the removal fails on the files
  ; the running process holds open — and this one also holds an FFmpeg child
  ; process writing segments. /t takes the children with it.
  nsExec::Exec 'taskkill /f /t /im "G-Recorder.exe"'
  Pop $0
  Sleep 500
!macroend

!macro customUnInstall
  ; The Run-key entry is written by the app at runtime, so NSIS has no record of
  ; it and would leave it pointing at a deleted executable. Both spellings are
  ; deleted because the value is named after app.getName(), which resolves to
  ; productName when the packaged package.json carries one and to name when it
  ; does not — a detail that must not decide whether an uninstall is clean.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "G-Recorder"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "g-recorder"
!macroend
