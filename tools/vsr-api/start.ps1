$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvPy = Join-Path $Root ".venv\Scripts\python.exe"

if (-not $env:VSR_ROOT) {
  $default = Join-Path (Split-Path -Parent $Root) "video-subtitle-remover"
  $env:VSR_ROOT = $default
}
if (-not $env:VSR_PYTHON) {
  $vsrVenvPy = Join-Path $env:VSR_ROOT ".venv\Scripts\python.exe"
  if (Test-Path $vsrVenvPy) {
    $env:VSR_PYTHON = $vsrVenvPy
  } else {
    $env:VSR_PYTHON = "python"
  }
}
if (-not $env:VSR_API_PORT) {
  $env:VSR_API_PORT = "7861"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $Root)
$ffmpegCandidates = @(
  (Join-Path $repoRoot "backend\node_modules\ffmpeg-static\ffmpeg.exe"),
  (Join-Path $env:VSR_ROOT "backend\ffmpeg\win_x64\ffmpeg.exe")
)
if (-not $env:VSR_FFMPEG_PATH) {
  foreach ($candidate in $ffmpegCandidates) {
    if (Test-Path $candidate) {
      $env:VSR_FFMPEG_PATH = $candidate
      break
    }
  }
}

Write-Host "VSR_ROOT=$env:VSR_ROOT"
Write-Host "VSR_PYTHON=$env:VSR_PYTHON"
Write-Host "VSR_FFMPEG_PATH=$env:VSR_FFMPEG_PATH"
Write-Host "VSR_API_PORT=$env:VSR_API_PORT"
Write-Host "Starting VSR API on 0.0.0.0:$env:VSR_API_PORT ..."

& $venvPy (Join-Path $Root "server.py")
