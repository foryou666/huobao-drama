$ErrorActionPreference = "Stop"
$ts = "C:\Program Files\Tailscale\tailscale.exe"
if (-not (Test-Path $ts)) {
  Write-Host "Tailscale not installed. Run: winget install Tailscale.Tailscale" -ForegroundColor Red
  exit 1
}

Write-Host "==> Tailscale status" -ForegroundColor Cyan
& $ts status

$ip = (& $ts ip -4 2>$null | Select-Object -First 1).Trim()
if (-not $ip) {
  Write-Host ""
  Write-Host "Not logged in. Run:" -ForegroundColor Yellow
  Write-Host "  & '$ts' login"
  exit 1
}

Write-Host ""
Write-Host "Tailscale IPv4: $ip" -ForegroundColor Green
Write-Host "VSR health (local): http://127.0.0.1:7861/health"
Write-Host "VSR health (tailscale): http://${ip}:7861/health"
Write-Host ""
Write-Host "Huobao settings -> 去字幕 API Base URL:" -ForegroundColor Cyan
Write-Host "  http://${ip}:7861"

try {
  $health = Invoke-RestMethod -Uri "http://${ip}:7861/health" -TimeoutSec 5
  Write-Host "VSR via Tailscale IP: OK (vsr_ready=$($health.vsr_ready))" -ForegroundColor Green
} catch {
  Write-Host "VSR via Tailscale IP: FAIL - ensure .\start.ps1 is running" -ForegroundColor Yellow
}
