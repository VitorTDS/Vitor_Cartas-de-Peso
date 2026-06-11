param(
  [int]$IntervalMinutes = 15,
  [string]$RepoPath = (Resolve-Path "$PSScriptRoot\..").Path
)

$ErrorActionPreference = "Continue"
$logDir = Join-Path $RepoPath "logs"
$logPath = Join-Path $logDir "autosave-git.log"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-AutoSaveLog {
  param([string]$Message)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "[$timestamp] $Message"
}

Write-AutoSaveLog "Autosave iniciado em $RepoPath a cada $IntervalMinutes minuto(s)."

while ($true) {
  try {
    Set-Location -LiteralPath $RepoPath
    $changes = git status --porcelain

    if ($changes) {
      git add -A
      $message = "chore: autosave $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
      git commit -m $message | Out-Null
      git push origin (git branch --show-current) | Out-Null
      Write-AutoSaveLog "Alteracoes salvas e enviadas: $message"
    } else {
      Write-AutoSaveLog "Sem alteracoes para salvar."
    }
  } catch {
    Write-AutoSaveLog "Erro: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds ($IntervalMinutes * 60)
}
