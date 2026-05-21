# NSIS installer for Windows CI (uses patched artifacts/win-payload).
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$version = node -p "require('./package.json').version"
$payload = "artifacts\win-payload"
$launcher = "Cross TTS-Setup.exe"

if (-not (Test-Path (Join-Path $payload $launcher))) {
	throw "Missing $payload\$launcher — run embed-win-icons.ps1 first"
}

$nsi = @"
!include "MUI2.nsh"

Name "Cross TTS"
OutFile "artifacts\Cross-TTS-$version-Setup.exe"
InstallDir "`$LOCALAPPDATA\Cross TTS"
InstallDirRegKey HKCU "Software\Cross TTS" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ICON "assets\windows\icon.ico"
!define MUI_UNICON "assets\windows\icon.ico"
!define MUI_WELCOMEPAGE_TITLE "Welcome to Cross TTS $version Setup"
!define MUI_FINISHPAGE_RUN "`$INSTDIR\$launcher"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Cross TTS"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "`$INSTDIR"
  File /r "$payload\*.*"

  CreateShortcut "`$DESKTOP\Cross TTS.lnk" "`$INSTDIR\$launcher" "" "`$INSTDIR\$launcher" 0
  CreateDirectory "`$SMPROGRAMS\Cross TTS"
  CreateShortcut "`$SMPROGRAMS\Cross TTS\Cross TTS.lnk" "`$INSTDIR\$launcher" "" "`$INSTDIR\$launcher" 0
  CreateShortcut "`$SMPROGRAMS\Cross TTS\Uninstall Cross TTS.lnk" "`$INSTDIR\Uninstall.exe"

  WriteUninstaller "`$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\Cross TTS" "InstallDir" "`$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "DisplayName" "Cross TTS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "DisplayVersion" "$version"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "Publisher" "Cross TTS"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "UninstallString" "`$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "DisplayIcon" "`$INSTDIR\$launcher"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS" "NoRepair" 1
SectionEnd

Section "Uninstall"
  Delete "`$DESKTOP\Cross TTS.lnk"
  Delete "`$SMPROGRAMS\Cross TTS\Cross TTS.lnk"
  Delete "`$SMPROGRAMS\Cross TTS\Uninstall Cross TTS.lnk"
  RMDir "`$SMPROGRAMS\Cross TTS"
  RMDir /r "`$INSTDIR"
  DeleteRegKey HKCU "Software\Cross TTS"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\CrossTTS"
SectionEnd
"@

$nsi | Out-File -FilePath installer.nsi -Encoding utf8
makensis installer.nsi
Remove-Item $payload -Recurse -Force
Write-Host "Created artifacts\Cross-TTS-$version-Setup.exe"
