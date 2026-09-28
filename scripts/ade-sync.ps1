<#
.SYNOPSIS
  Keeps the native Windows and native Linux checkouts of ADE in step via origin.

.DESCRIPTION
  save [message]   before leaving Windows: commit everything, push the branch
  load             after booting Windows: fast-forward pull, reinstall if deps changed
  status           fetch and show branch, local changes, ahead/behind

  Linux counterpart: scripts/ade-sync.sh. Messages stay ASCII so Windows
  PowerShell 5.1 reads this file correctly without a BOM.

.EXAMPLE
  .\scripts\ade-sync.ps1 save
  .\scripts\ade-sync.ps1 save "feat: dictation retry"
  .\scripts\ade-sync.ps1 load
#>
param(
  [Parameter(Position = 0)][ValidateSet('save', 'load', 'status')][string]$Command,
  [Parameter(Position = 1)][string]$Message
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Info([string]$text) { Write-Host "[ade-sync] $text" -ForegroundColor Cyan }
function Fail([string]$text) { Write-Host "[ade-sync] $text" -ForegroundColor Red; exit 1 }

# Not named "Git": a function would shadow git.exe and call itself.
function Invoke-Git {
  & git @args
  if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed (exit $LASTEXITCODE)" }
}

function Get-Branch {
  $b = & git symbolic-ref --quiet --short HEAD
  if ($LASTEXITCODE -ne 0) { Fail 'Kein Branch ausgecheckt (detached HEAD). Erst einen Branch auschecken.' }
  return $b
}

function Test-Dirty { return [bool](& git status --porcelain) }

function Test-Upstream {
  # Windows PowerShell 5.1 turns redirected native stderr into a terminating error under 'Stop'.
  $ErrorActionPreference = 'Continue'
  & git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}

function Install-Deps {
  Info 'Installiere Abhaengigkeiten fuer Windows ...'
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { Fail 'pnpm install fehlgeschlagen. Laeuft ADE noch? Dann ADE beenden und erneut versuchen.' }
  # pnpm can skip Electron's postinstall; without path.txt electron-vite reports "Electron uninstall".
  if (!(Test-Path 'node_modules\electron\path.txt')) {
    Info 'Lade Electron-Binary nach ...'
    Push-Location 'node_modules\electron'
    try { & node install.js; if ($LASTEXITCODE -ne 0) { Fail 'Electron-Download fehlgeschlagen.' } } finally { Pop-Location }
  }
}

switch ($Command) {
  'save' {
    $b = Get-Branch
    if (Test-Dirty) {
      if (!$Message) { $Message = "wip: sync von $env:COMPUTERNAME $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
      Invoke-Git add -A
      Invoke-Git commit -m $Message
      Info "Commit auf '$b': $Message"
    } else {
      Info 'Keine lokalen Aenderungen.'
    }
    if (Test-Upstream) { Invoke-Git push } else { Invoke-Git push -u origin $b }
    Info 'Gepusht. Du kannst jetzt das Betriebssystem wechseln.'
  }
  'load' {
    $b = Get-Branch
    if (Test-Dirty) {
      & git status --short
      Fail "Lokale Aenderungen vorhanden. Erst 'ade-sync save' ausfuehren oder die Aenderungen verwerfen."
    }
    $old = & git rev-parse HEAD
    & git pull --ff-only
    if ($LASTEXITCODE -ne 0) { Fail "Pull nicht per Fast-Forward moeglich: auf beiden Seiten wurde committet. Mit 'git pull --rebase' zusammenfuehren." }
    $new = & git rev-parse HEAD

    if (!(Test-Path 'node_modules')) {
      Install-Deps
    } elseif ($old -ne $new -and (& git diff --name-only $old $new | Where-Object { $_ -in @('package.json', 'pnpm-lock.yaml') })) {
      Install-Deps
    } else {
      Info 'Abhaengigkeiten unveraendert.'
    }

    if ($old -eq $new) {
      Info "'$b' war schon aktuell."
    } else {
      Info "'$b' aktualisiert: $(& git rev-list --count "$old..$new") neue Commits."
      Info 'Persoenliche Instanz neu starten: pnpm activate'
    }
  }
  'status' {
    $b = Get-Branch
    Invoke-Git fetch --quiet origin
    Info "Branch: $b"
    if (Test-Upstream) {
      $counts = (& git rev-list --left-right --count 'HEAD...@{u}') -split '\s+'
      Info "Nicht gepusht: $($counts[0])  -  Noch nicht geholt: $($counts[1])"
    } else {
      Info 'Noch nie gepusht (kein Upstream).'
    }
    if (Test-Dirty) {
      Info 'Lokale Aenderungen:'
      & git status --short
    } else {
      Info 'Keine lokalen Aenderungen.'
    }
  }
  default { Get-Help $PSCommandPath -Detailed; exit 1 }
}
