# Workaround for https://github.com/blackboardsh/electrobun/issues/429
# Electrobun's CLI cannot resolve rcedit; patch Windows .exe icons in CI only.
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repoRoot

$icon = Join-Path $repoRoot "assets\windows\icon.ico"
if (-not (Test-Path $icon)) {
	throw "Missing icon file: $icon (commit assets/windows/icon.ico)"
}

$artifacts = Join-Path $repoRoot "artifacts"
if (-not (Test-Path $artifacts)) {
	throw "artifacts/ not found; run build:stable first"
}

$rceditUrl = "https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe"
$rcedit = Join-Path $env:TEMP "rcedit-x64.exe"
if (-not (Test-Path $rcedit)) {
	Invoke-WebRequest -Uri $rceditUrl -OutFile $rcedit
}

function Set-ExeIcon {
	param([string]$ExePath)
	Write-Host "Patching $ExePath"
	& $rcedit $ExePath --set-icon $icon
	if ($LASTEXITCODE -ne 0) {
		throw "rcedit failed for $ExePath (exit $LASTEXITCODE)"
	}
}

$patched = 0

# Loose executables (e.g. future artifact layouts)
Get-ChildItem $artifacts -Recurse -Filter "*.exe" -File |
	Where-Object { $_.FullName -notmatch "\\win-payload\\" } |
	ForEach-Object {
		Set-ExeIcon $_.FullName
		$patched++
	}

# Electrobun ships the setup .exe inside *Setup.zip only
Get-ChildItem $artifacts -Filter "*Setup.zip" -File | ForEach-Object {
	$zip = $_.FullName
	$stage = Join-Path $env:TEMP ("cross-tts-icon-" + [Guid]::NewGuid().ToString())
	New-Item -ItemType Directory -Path $stage -Force | Out-Null

	try {
		Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force

		Get-ChildItem $stage -Recurse -Filter "*.exe" -File | ForEach-Object {
			Set-ExeIcon $_.FullName
			$patched++
		}

		Remove-Item $zip -Force
		Push-Location $stage
		try {
			# Preserve zip layout (Setup.exe + .installer/ at archive root)
			tar -a -cf $zip *
		} finally {
			Pop-Location
		}

		Write-Host "Repacked $zip"
	} finally {
		Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
	}
}

if ($patched -eq 0) {
	throw "No Windows executables were patched in artifacts/"
}

Write-Host "Patched $patched executable(s)"

# Staged payload for NSIS (patched Electrobun layout, not raw artifacts/)
$payload = Join-Path $artifacts "win-payload"
if (Test-Path $payload) {
	Remove-Item $payload -Recurse -Force
}
New-Item -ItemType Directory -Path $payload -Force | Out-Null

$setupZip = Get-ChildItem $artifacts -Filter "*Setup.zip" -File | Select-Object -First 1
if (-not $setupZip) {
	throw "No *Setup.zip found in artifacts/ for NSIS payload"
}
Expand-Archive -LiteralPath $setupZip.FullName -DestinationPath $payload -Force
Write-Host "NSIS payload staged at $payload"
