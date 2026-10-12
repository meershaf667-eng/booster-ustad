; Booster Ustad — Windows installer (built with native NSIS on Linux,
; since electron-builder's bundled makensis.exe requires wine).
; Per-user install: no administrator rights needed.
!include "MUI2.nsh"

Name "Booster Ustad"
OutFile "/home/hatch/workspace/booster-ustad/dist/Booster Ustad Setup 0.1.0.exe"
InstallDir "$LOCALAPPDATA\Programs\Booster Ustad"
RequestExecutionLevel user

VIProductVersion "0.1.0.0"
VIAddVersionKey "ProductName" "Booster Ustad"
VIAddVersionKey "FileDescription" "Booster Ustad"
VIAddVersionKey "FileVersion" "0.1.0"
VIAddVersionKey "LegalCopyright" "Booster Ustad"

!define MUI_ICON "/home/hatch/workspace/booster-ustad/electron/icon.ico"
!define MUI_UNICON "/home/hatch/workspace/booster-ustad/electron/icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Welcome to Booster Ustad"
!define MUI_WELCOMEPAGE_TEXT "This will install Booster Ustad on your computer.$\r$\n$\r$\nClick Next to continue."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Booster Ustad.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Booster Ustad now"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "/home/hatch/workspace/booster-ustad/dist/win-unpacked\*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\Booster Ustad"
  CreateShortcut "$SMPROGRAMS\Booster Ustad\Booster Ustad.lnk" "$INSTDIR\Booster Ustad.exe" "" "$INSTDIR\Booster Ustad.exe"
  CreateShortcut "$SMPROGRAMS\Booster Ustad\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  ; Desktop shortcut
  CreateShortcut "$DESKTOP\Booster Ustad.lnk" "$INSTDIR\Booster Ustad.exe" "" "$INSTDIR\Booster Ustad.exe"

  ; Add/Remove Programs entry (per-user)
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "DisplayName" "Booster Ustad"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "Publisher" "Booster Ustad"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "DisplayIcon" "$INSTDIR\Booster Ustad.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\Booster Ustad.lnk"
  Delete "$SMPROGRAMS\Booster Ustad\Booster Ustad.lnk"
  Delete "$SMPROGRAMS\Booster Ustad\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Booster Ustad"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Booster Ustad"
  ; NOTE: user data (database + uploads in %APPDATA%\Booster Ustad) is kept
  ; so reinstalling never wipes the user's content.
SectionEnd
