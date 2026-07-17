Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -like '*server.py*' } |
  ForEach-Object {
    Write-Host "Stopping PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2
Remove-Item Env:VSR_API_KEY -ErrorAction SilentlyContinue
Set-Location $PSScriptRoot
& (Join-Path $PSScriptRoot 'start.ps1')
