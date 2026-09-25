$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logsPath = Join-Path $projectRoot 'backend\logs'
$serverPath = Join-Path $projectRoot 'backend\src\server.js'
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
Set-Location -LiteralPath $projectRoot
Set-Content -LiteralPath (Join-Path $logsPath 'launcher-marker.txt') -Value (Get-Date).ToString('o')
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Get-Command node).Source
  $psi.Arguments = "--no-warnings `"$serverPath`""
  $psi.WorkingDirectory = $projectRoot
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [void][System.Diagnostics.Process]::Start($psi)
} catch {
  Set-Content -LiteralPath (Join-Path $logsPath 'launcher-err.log') -Value $_.Exception.ToString()
  throw
}
