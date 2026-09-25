Set-Location -LiteralPath 'C:\novo\CARTAS DE PESO SOBRAL'
$root = 'C:\novo\CARTAS DE PESO SOBRAL'
$heartbeat = Join-Path $root 'logs\watch-heartbeat.txt'
$marker = Join-Path $root 'logs\launcher-marker.txt'
Set-Content -LiteralPath $marker -Value (Get-Date).ToString('o')

while ($true) {
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = 'C:\Program Files\nodejs\node.exe'
    $psi.Arguments = '--no-warnings "C:\novo\CARTAS DE PESO SOBRAL\src\server.js"'
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
    if ($stdout) { Add-Content -LiteralPath (Join-Path $root 'logs\watch-stdout.log') -Value $stdout }
    if ($stderr) { Add-Content -LiteralPath (Join-Path $root 'logs\watch-stderr.log') -Value $stderr }
    Add-Content -LiteralPath $heartbeat -Value "pid=$($proc.Id) exited=$($proc.ExitCode) at $((Get-Date).ToString('o'))"
  } catch {
    Add-Content -LiteralPath $heartbeat -Value "error=$(($_.Exception.Message)) at $(Get-Date).ToString('o')"
  }
  Start-Sleep -Seconds 2
}
