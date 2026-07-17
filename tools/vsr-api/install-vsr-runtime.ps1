# Install VSR GPU runtime (Windows, NVIDIA CUDA 12.x)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$VsrRoot = Join-Path (Split-Path -Parent $Root) "video-subtitle-remover"
$venv = Join-Path $VsrRoot ".venv"

$pythonCandidates = @(
  $env:PYTHON_EXE,
  "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
  (Get-Command python -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
) | Where-Object { $_ -and (Test-Path $_) }
$basePy = $pythonCandidates | Select-Object -First 1
if (-not $basePy) {
  Write-Host "ERROR: Python 3.12+ not found. Install Python.Python.3.12 via winget." -ForegroundColor Red
  exit 1
}
Write-Host "    Python: $basePy"

$py = Join-Path $venv "Scripts\python.exe"
$pip = Join-Path $venv "Scripts\pip.exe"

Write-Host "==> VSR runtime setup" -ForegroundColor Cyan
Write-Host "    VSR_ROOT: $VsrRoot"

if (-not (Test-Path "$VsrRoot\backend\main.py")) {
  Write-Host "ERROR: VSR source missing. Run setup.ps1 first." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $venv)) {
  Write-Host "==> Creating VSR venv..." -ForegroundColor Yellow
  & $basePy -m venv $venv
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $py)) {
    Write-Host "ERROR: failed to create venv at $venv" -ForegroundColor Red
    exit 1
  }
}

Write-Host "==> Upgrading pip..." -ForegroundColor Yellow
$env:PIP_DEFAULT_TIMEOUT = "1000"
& $py -m pip install -U pip wheel setuptools

# RTX 50-series: prefer cu126 (cu128 wheel is ~3.3GB and often times out)
Write-Host "==> Installing PyTorch (CUDA 12.6)..." -ForegroundColor Yellow
& $pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu126
if ($LASTEXITCODE -ne 0) {
  Write-Host "cu126 failed, trying cu128..." -ForegroundColor Yellow
  & $pip install torch==2.7.0 torchvision==0.22.0 --index-url https://download.pytorch.org/whl/cu128
}

Write-Host "==> Installing PaddlePaddle GPU..." -ForegroundColor Yellow
& $pip install paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
if ($LASTEXITCODE -ne 0) {
  Write-Host "cu126 paddle failed, trying cu118..." -ForegroundColor Yellow
  & $pip install paddlepaddle-gpu==3.0.0 -i https://www.paddlepaddle.org.cn/packages/stable/cu118/
}

Write-Host "==> Installing VSR requirements..." -ForegroundColor Yellow
& $pip install -r (Join-Path $VsrRoot "requirements.txt")

Write-Host "==> Smoke test..." -ForegroundColor Yellow
& $py (Join-Path $VsrRoot "backend\main.py") -h
if ($LASTEXITCODE -ne 0) {
  Write-Host "WARN: main.py -h failed; check CUDA/driver compatibility." -ForegroundColor Yellow
  exit 1
}

Write-Host ""
Write-Host "VSR runtime ready." -ForegroundColor Green
Write-Host "  `$env:VSR_ROOT = '$VsrRoot'"
Write-Host "  `$env:VSR_PYTHON = '$py'"
Write-Host "  cd tools\vsr-api; .\start.ps1"
