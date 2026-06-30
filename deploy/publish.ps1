param(
  [ValidateSet('sync-code', 'publish', 'restart', 'status', 'logs')]
  [string]$Action = 'sync-code'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$password = $env:DEPLOY_SSH_PASSWORD
if (-not $password) {
  Write-Host '请先设置: $env:DEPLOY_SSH_PASSWORD = "你的SSH密码"' -ForegroundColor Yellow
  exit 1
}

Push-Location (Join-Path $root 'deploy')
if (-not (Test-Path 'node_modules')) { npm install --silent }
Pop-Location

$remote = Join-Path $root 'deploy\remote.mjs'
switch ($Action) {
  'sync-code' { node $remote sync-code }
  'publish'   { node $remote publish }
  'restart'   { node $remote exec 'systemctl restart hongguoduanju && systemctl status hongguoduanju --no-pager | head -12' }
  'status'    { node $remote exec 'systemctl status hongguoduanju --no-pager | head -15' }
  'logs'      { node $remote exec 'journalctl -u hongguoduanju -n 40 --no-pager' }
}
