$ErrorActionPreference = "Stop"

Write-Host "=== 1. 持久环境变量 VSR_API_KEY ===" -ForegroundColor Cyan
$userKey = [Environment]::GetEnvironmentVariable("VSR_API_KEY", "User")
$machineKey = [Environment]::GetEnvironmentVariable("VSR_API_KEY", "Machine")
Write-Host "用户级: $(if ($userKey) { $userKey } else { '(未设置)' })"
Write-Host "系统级: $(if ($machineKey) { $machineKey } else { '(未设置)' })"
Write-Host "当前 PowerShell 会话: $(if ($env:VSR_API_KEY) { $env:VSR_API_KEY } else { '(未设置)' })"
Write-Host ""
Write-Host "说明: 密钥只在「启动 VSR 的那个窗口」里生效，不会写进文件。" -ForegroundColor DarkGray
Write-Host ""

Write-Host "=== 2. 占用 7861 端口的进程 ===" -ForegroundColor Cyan
$lines = netstat -ano | Select-String ":7861"
if (-not $lines) {
  Write-Host "7861 端口未被占用（VSR 未运行）" -ForegroundColor Yellow
} else {
  $lines | ForEach-Object { Write-Host $_.Line.Trim() }
  $pids = $lines | ForEach-Object {
    if ($_ -match "\s(\d+)\s*$") { [int]$Matches[1] }
  } | Sort-Object -Unique
  foreach ($pid in $pids) {
    if ($pid -le 0) { continue }
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid" -ErrorAction SilentlyContinue
    if ($proc) {
      Write-Host "PID $pid -> $($proc.CommandLine)" -ForegroundColor Green
    }
  }
}
Write-Host ""

Write-Host "=== 3. 正在运行的 server.py 进程 ===" -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like "*server.py*" } |
  ForEach-Object {
    Write-Host "PID $($_.ProcessId)"
    Write-Host $_.CommandLine
    Write-Host ""
  }

Write-Host "=== 4. 本机 VSR /health ===" -ForegroundColor Cyan
try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:7861/health" -TimeoutSec 5
  $health | ConvertTo-Json -Compress
  if ($health.auth_required -eq $true) {
    Write-Host "当前 VSR 需要 API Key（但无法从进程外读出具体值，请看启动 VSR 的窗口历史）" -ForegroundColor Yellow
  } else {
    Write-Host "当前 VSR 未启用密钥校验，线上可不填 API Key" -ForegroundColor Green
  }
} catch {
  Write-Host "无法访问 http://127.0.0.1:7861/health : $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== 5. 鉴权探测（故意传错密钥） ===" -ForegroundColor Cyan
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:7861/v1/jobs" -Method POST -Headers @{ Authorization = "Bearer probe-wrong-key" } -TimeoutSec 5 | Out-Null
  Write-Host "意外: 应返回 422 或 401" -ForegroundColor Yellow
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 401) {
    Write-Host "返回 401 -> 本机 VSR 已启用密钥。请在「启动 VSR 的 PowerShell」里查看 `$env:VSR_API_KEY，或清空后重启。" -ForegroundColor Red
  } elseif ($code -eq 422) {
    Write-Host "返回 422（缺 file）-> 密钥未启用或已匹配，可正常对接" -ForegroundColor Green
  } else {
    Write-Host "HTTP $code"
  }
}
