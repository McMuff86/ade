<#
.SYNOPSIS
  Restarts the personal ADE instance on a freshly checked build, with a way back.

.DESCRIPTION
  1. Gate: `scripts/verify.ts --gate` (typecheck, focused suites, isolated
     build, core Electron/browser drivers). With -SkipGate only typecheck and
     the isolated build run; the activation is recorded as unverified and the
     full `pnpm verify` starts in the background afterwards, unless the operator
     explicitly uses -DeferVerification to perform manual testing first.
  2. Refuses to quit while ADE owns terminal or agent processes, unless -Force.
  3. Backs up the profile to ~/ADE-Backups/Activate-<Label>-<timestamp>.
  4. Quits the running instance gracefully (`electron <repo> --ade-quit`).
  5. Keeps the running build as out.prev and installs the checked build as out.
  6. Starts ADE like the Start-menu shortcut and checks that it came up.

  -Rollback swaps out and out.prev and restarts, without building.
  Never builds into out/ while ADE runs from it. Native Windows host only.

.EXAMPLE
  pnpm activate -- -Label Sketch
  pnpm activate -- -Label Hotfix -SkipGate
  pnpm activate -- -Rollback
#>
param(
  [string]$Label = 'Update',
  [switch]$SkipGate,
  [switch]$DeferVerification,
  [switch]$Rollback,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$out = Join-Path $repo 'out'
$previous = Join-Path $repo 'out.prev'
$staged = Join-Path $repo 'test-results\verify-build'
$records = Join-Path $repo 'test-results\activations.jsonl'
# ADE_USER_DATA_DIR and ADE_BACKUP_DIR point a rehearsal at a throwaway profile;
# the started ADE inherits the same profile override.
$userData = if ($env:ADE_USER_DATA_DIR) { $env:ADE_USER_DATA_DIR } else { Join-Path $env:APPDATA 'ade' }
$mainLog = Join-Path $userData 'ade\logs\main.log'
$backupRoot = if ($env:ADE_BACKUP_DIR) { $env:ADE_BACKUP_DIR } else { Join-Path $env:USERPROFILE 'ADE-Backups' }
$keepBackups = 15
Set-Location $repo
$electron = (& node -p "require('electron')").Trim()
if ($Label -notmatch '^[A-Za-z0-9-]{1,40}$') { throw 'Label: 1-40 letters, digits or dashes.' }
if ($DeferVerification -and !$SkipGate) { throw '-DeferVerification requires -SkipGate.' }

function Assert-ChildPath([string]$target, [string]$root) {
  $absolute = [IO.Path]::GetFullPath($target)
  $prefix = [IO.Path]::GetFullPath($root).TrimEnd([char[]]'\/') + [IO.Path]::DirectorySeparatorChar
  if (!$absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw "Path leaves intended directory: $absolute" }
}
foreach ($target in @($out, $previous, $staged, (Join-Path $repo 'out.swap'))) { Assert-ChildPath $target $repo }

function Step([string]$text) { Write-Host "==> $text" }

function Get-AdeOwner {
  # The personal instance runs as `electron.exe "<repo>"`, exactly like the
  # Start-menu shortcut. Test runs start a script path with their own profile.
  $pattern = '^"?' + [regex]::Escape($electron) + '"?\s+"?' + [regex]::Escape($repo) + '\\?"?\s*$'
  Get-CimInstance Win32_Process -Filter "Name='electron.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } | Select-Object -First 1
}

function Get-Descendants([int]$root) {
  $all = @(Get-CimInstance Win32_Process); $ids = @($root)
  do {
    $next = @($all | Where-Object { [int]$_.ParentProcessId -in $ids -and [int]$_.ProcessId -notin $ids })
    $ids += @($next | ForEach-Object { [int]$_.ProcessId })
  } while ($next.Count)
  $all | Where-Object { [int]$_.ProcessId -in $ids -and [int]$_.ProcessId -ne $root }
}

function Test-Listening([int]$processId) {
  [bool](Get-NetTCPConnection -State Listen -LocalPort 4317 -ErrorAction SilentlyContinue |
    Where-Object { $_.OwningProcess -eq $processId })
}

function Invoke-Verify([string[]]$arguments) {
  & node --import tsx (Join-Path $repo 'scripts\verify.ts') @arguments
  # Exit 2: refused before running, e.g. while the owed full run still holds the build.
  if ($LASTEXITCODE -ne 0) { throw "verify $($arguments -join ' ') did not pass (exit $LASTEXITCODE); ADE keeps running unchanged." }
}

function Source-Id([string]$build) {
  (Get-FileHash -Algorithm SHA256 (Join-Path $build 'main\index.js')).Hash.Substring(0, 20).ToLowerInvariant()
}

# 1. Build and check while the current instance keeps running.
$gate = 'rollback'
if ($Rollback) {
  if (!(Test-Path (Join-Path $previous 'main\index.js'))) { throw 'No previous build (out.prev) to roll back to.' }
} elseif ($SkipGate) {
  Step 'Typecheck and isolated build (gate skipped)'
  Invoke-Verify @('--only', 'typecheck:node,typecheck:web,typecheck:scripts,build:desktop,build:mobile')
  $gate = 'skipped'
} else {
  Step 'Gate: typecheck, focused suites, isolated build, core drivers'
  Invoke-Verify @('--gate')
  $gate = 'passed'
}

# 2. Nothing that runs inside ADE is ended silently.
$owner = Get-AdeOwner
$wasListening = $false
if ($owner) {
  $busy = @(Get-Descendants $owner.ProcessId | Where-Object { $_.Name -notin @('electron.exe', 'crashpad_handler.exe') })
  if ($busy.Count -gt 0 -and !$Force) {
    throw ("ADE (PID $($owner.ProcessId)) still runs terminals or agents: " + (($busy | ForEach-Object { $_.Name } | Sort-Object -Unique) -join ', ') +
      '. Finish them, or run again with -Force to end them.')
  }
  $wasListening = Test-Listening $owner.ProcessId
}

# 3. Profile backup (settings, devices, notes, conversations, usage, browser storage).
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $backupRoot "Activate-$Label-$stamp"
Step "Backup to $backup"
New-Item -ItemType Directory -Force $backup | Out-Null
foreach ($item in @('config.json', 'conversations.json', 'conversation-actions.json', 'harness-credentials.json', 'organizer.json', 'supervision.json', 'remote', 'usage', 'agents', 'photos')) {
  $source = Join-Path $userData "ade\$item"
  if (Test-Path $source) { Copy-Item $source (Join-Path $backup $item) -Recurse -Force }
}
# Local State holds the safeStorage key that decrypts the credentials above.
foreach ($item in @('Local State', 'IndexedDB', 'Local Storage')) {
  $source = Join-Path $userData $item
  if (Test-Path $source) { Copy-Item $source (Join-Path $backup $item) -Recurse -Force }
}
# Only this script's own backups are pruned; hand-made ones stay.
Get-ChildItem $backupRoot -Directory -Filter 'Activate-*' | Sort-Object CreationTime -Descending |
  Select-Object -Skip $keepBackups | ForEach-Object { Assert-ChildPath $_.FullName $backupRoot; Remove-Item -LiteralPath $_.FullName -Recurse -Force }

# 4. Graceful quit through the owner's own shutdown path.
if ($owner) {
  Step "Quitting ADE (PID $($owner.ProcessId))"
  Start-Process -FilePath $electron -ArgumentList "`"$repo`"", '--ade-quit' -WorkingDirectory $repo -WindowStyle Hidden
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }
  if (Get-Process -Id $owner.ProcessId -ErrorAction SilentlyContinue) {
    throw "ADE (PID $($owner.ProcessId)) did not quit within 30 s. Builds from before --ade-quit need one quit via the tray menu; out/ is unchanged."
  }
}

function Start-Ade {
  Start-Process -FilePath $electron -ArgumentList "`"$repo`"" -WorkingDirectory $repo | Out-Null
}

# 5. Swap builds; the build that ran until now stays as out.prev.
try {
  if ($Rollback) {
    Step 'Swapping out and out.prev'
    $parking = Join-Path $repo 'out.swap'
    Move-Item $out $parking; Move-Item $previous $out; Move-Item $parking $previous
  } else {
    Step 'Installing the checked build (previous build kept as out.prev)'
    if (Test-Path $previous) { Remove-Item $previous -Recurse -Force }
    if (Test-Path $out) { Move-Item $out $previous }
    Copy-Item $staged $out -Recurse
  }
} catch {
  # ADE is already down: bring the build that ran before back up, then fail.
  if (!(Test-Path (Join-Path $out 'main\index.js')) -and (Test-Path (Join-Path $previous 'main\index.js'))) {
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    Move-Item $previous $out
  }
  Start-Ade
  throw "Build swap failed, previous build restarted: $($_.Exception.Message)"
}

# 6. Start like the Start-menu shortcut and wait until the desktop is ready.
$started = Get-Date
Step 'Starting ADE'
Start-Ade
$deadline = $started.AddSeconds(90); $ready = $false; $current = $null
while ((Get-Date) -lt $deadline -and !$ready) {
  Start-Sleep -Milliseconds 500
  $current = Get-AdeOwner
  $readyLine = Get-Content $mainLog -Tail 50 -ErrorAction SilentlyContinue | Where-Object { $_ -match 'app ready' } | Select-Object -Last 1
  if ($current -and $readyLine) {
    # main.log lines start with an ISO UTC timestamp (24 characters).
    $readyAt = [datetime]::Parse($readyLine.Substring(0, 24), [Globalization.CultureInfo]::InvariantCulture)
    if ($readyAt -ge $started.AddSeconds(-1)) { $ready = !$wasListening -or (Test-Listening $current.ProcessId) }
  }
}
if (!$ready) { throw 'ADE did not report ready within 90 s (see main.log). Roll back with: pnpm activate -- -Rollback' }

$sourceId = Source-Id $out
$record = [ordered]@{
  at = (Get-Date).ToString('o'); label = $Label; gate = $gate
  head = (git rev-parse --short HEAD).Trim(); dirtyFiles = @(git status --porcelain).Count
  sourceId = $sourceId; pid = $current.ProcessId; previousPid = $owner.ProcessId; listener = $wasListening; backup = $backup
  verificationDeferred = [bool]$DeferVerification
}
Add-Content -Path $records -Value ($record | ConvertTo-Json -Compress)
Step "ADE runs as PID $($current.ProcessId), source $sourceId, gate $gate"

if ($gate -eq 'skipped' -and !$DeferVerification) {
  # The skipped proof is owed: run the full isolated verification now.
  $console = Join-Path $repo 'test-results\verify-console.log'
  Start-Process -FilePath pwsh -WindowStyle Hidden -WorkingDirectory $repo `
    -ArgumentList '-NoProfile', '-Command', "pnpm verify *> '$console'"
  Step "Unverified activation: full verify started in the background ($console)"
}
if ($gate -eq 'skipped' -and $DeferVerification) { Step 'Unverified activation: tests explicitly deferred; no background verification started.' }
