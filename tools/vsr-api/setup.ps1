# Setup local VSR API on Windows
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VsrRoot = Join-Path (Split-Path -Parent $Root) "video-subtitle-remover"

Write-Host "==> VSR API setup" -ForegroundColor Cyan
Write-Host "    tools dir: $Root"

$mainPy = Join-Path $VsrRoot "backend\main.py"
if (-not (Test-Path $mainPy)) {
  Write-Host "==> Fetching VSR source (API, skips large models)..." -ForegroundColor Yellow
  $fetchPy = Join-Path $Root "fetch_vsr_source.py"
  python $fetchPy $VsrRoot
  if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: fetch failed. Try: git clone --depth 1 https://github.com/foryou666/video-subtitle-remover.git" -ForegroundColor Red
    exit 1
  }
} else {
  Write-Host "==> VSR source exists: $VsrRoot"
}

$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pyCmd) {
  Write-Host "ERROR: python not found. Install Python 3.12+ first." -ForegroundColor Red
  exit 1
}

$venv = Join-Path $Root ".venv"
if (-not (Test-Path $venv)) {
  Write-Host "==> Creating API venv..." -ForegroundColor Yellow
  python -m venv $venv
}

$pip = Join-Path $venv "Scripts\pip.exe"
$py = Join-Path $venv "Scripts\python.exe"
& $pip install -r (Join-Path $Root "requirements.txt")

Write-Host ""
Write-Host "Next steps:" -ForegroundColor Green
Write-Host "1. Install VSR runtime in a separate Python env (see VSR README / GPU CUDA wheel)"
Write-Host "   Repo: https://github.com/foryou666/video-subtitle-remover"
Write-Host "2. Set env before start:"
Write-Host "   `$env:VSR_ROOT = '$VsrRoot'"
Write-Host "   `$env:VSR_PYTHON = '<python-with-vsr-deps>'"
Write-Host "   `$env:VSR_API_KEY = 'your-secret'   # optional"
Write-Host "3. Run: .\start.ps1"
Write-Host "4. Download models/ffmpeg: python fetch_vsr_assets.py"
Write-Host "5. In huobao admin settings, set 去字幕 API = http://<your-tunnel-or-lan-ip>:7861"
