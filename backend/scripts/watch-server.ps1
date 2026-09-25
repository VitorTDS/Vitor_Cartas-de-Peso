$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logsPath = Join-Path $root 'backend\logs'
$serverPath = Join-Path $root 'backend\src\server.js'
New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
Set-Location -LiteralPath $root
$heartbeat = Join-Path $logsPath 'watch-heartbeat.txt'
$marker = Join-Path $logsPath 'launcher-marker.txt'
Set-Content -LiteralPath $marker -Value (Get-Date).ToString('o')

while ($true) {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = (Get-Command node).Source
    $psi.Arguments = "--no-warnings `"$serverPath`""
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true

    $proc = [System.Diagnostics.Process]::Start($psi)
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    Set-Content -LiteralPath $heartbeat -Value "pid=$($proc.Id) started=$((Get-Date).ToString('o'))"
    $proc.WaitForExit()
    $stdout = $stdoutTask.GetAwaiter().GetResult()
    $stderr = $stderrTask.GetAwaiter().GetResult()
    if ($stdout) { Add-Content -LiteralPath (Join-Path $logsPath 'watch-stdout.log') -Value $stdout }
    if ($stderr) { Add-Content -LiteralPath (Join-Path $logsPath 'watch-stderr.log') -Value $stderr }
    Add-Content -LiteralPath $heartbeat -Value "pid=$($proc.Id) exited=$($proc.ExitCode) at $((Get-Date).ToString('o'))"
  } catch {
    Add-Content -LiteralPath $heartbeat -Value "error=$(($_.Exception.Message)) at $(Get-Date).ToString('o')"
  }
  Start-Sleep -Seconds 2
}
