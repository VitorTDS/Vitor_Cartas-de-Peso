Set-Location -LiteralPath 'C:\novo\CARTAS DE PESO SOBRAL'
Set-Content -LiteralPath 'logs\launcher-marker.txt' -Value (Get-Date).ToString('o')
try {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'C:\Program Files\nodejs\node.exe'
  $psi.Arguments = '--no-warnings "C:\novo\CARTAS DE PESO SOBRAL\src\server.js"'
  $psi.WorkingDirectory = 'C:\novo\CARTAS DE PESO SOBRAL'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [void][System.Diagnostics.Process]::Start($psi)
} catch {
  Set-Content -LiteralPath 'logs\launcher-err.log' -Value $_.Exception.ToString()
  throw
}
