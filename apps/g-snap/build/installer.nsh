; G-Snap installer customisation.
;
; THE PROBLEM THIS SOLVES
;
; Launch-at-startup is a SCHEDULED TASK, not a Run-key entry: Windows refuses
; to auto-start an app that requires administrator from the usual startup list.
; The app creates that task itself at runtime (main/settings/startup.ts), so
; NSIS has no record of it.
;
; Without the macros below an uninstall left the task behind, and it went on
; relaunching the deleted app at every logon. Worse, the app runs elevated, so
; a per-user (unelevated) uninstaller could neither terminate it nor delete its
; files — the uninstall removed its own registry entry, gave up, and left an app
; that was gone from Control Panel but still running and still starting at every
; logon. That is why `perMachine` is true: the uninstaller has to be elevated to
; undo what an elevated app set up.

!macro customInstall
  ; Start the app as soon as it is installed.
  ;
  ; The installer is already elevated, so a plain Exec hands the app that same
  ; token — it runs as administrator with no second UAC prompt for something the
  ; user just approved. electron-builder's own finish-page launch deliberately
  ; drops privileges, and for an app manifested requireAdministrator that means
  ; an immediate prompt instead, which is why runAfterFinish is off.
  ;
  ; This first run is also what registers the logon task. The task carries
  ; /RL HIGHEST, so every start after this one is elevated and silent as well.
  Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
!macroend

!macro customUnInit
  ; Stop the app BEFORE any files are removed, or the removal fails on the
  ; files the running process holds open.
  nsExec::Exec 'taskkill /f /im "G-Snap.exe"'
  Pop $0
  Sleep 500
!macroend

!macro customUnInstall
  ; /f so a silent uninstall is not left waiting on a prompt. A missing task is
  ; not an error worth reporting: the user may have turned the setting off.
  nsExec::Exec 'schtasks /delete /tn "G-Snap" /f'
  Pop $0
!macroend
