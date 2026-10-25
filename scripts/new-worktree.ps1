<#
.SYNOPSIS
  Create a git worktree that can actually run the app.

.DESCRIPTION
  `git worktree add` gives you tracked files and nothing else. This repo needs
  three untracked things to boot, and each one fails in a way that does not name
  itself:

    - .env.local          missing DATABASE_URL throws at import, not at query
    - BETTER_AUTH_URL     pointing at :3000 from a worktree served on :3001
                          breaks cookies and OAuth callbacks, and reads as an
                          auth bug rather than a config one
    - node_modules        per worktree; they are not shareable

  So the script supplies them. The worktrees live outside OneDrive on purpose:
  each carries ~1.5GB of node_modules and .next once built, and OneDrive holding
  a lock on a file mid-install is a recurring, opaque failure. The clone itself
  stays in OneDrive; only the regenerable output moves out. See docs/worktrees.md.

.NOTES
  ASCII only, deliberately. Windows PowerShell 5.1 reads a BOM-less file as ANSI,
  so a UTF-8 em dash arrives as three cp1252 characters, the last of which is a
  smart quote - which PowerShell accepts as a string delimiter. The result is a
  parse error pointing at a brace several lines away. Keep the punctuation plain.

.EXAMPLE
  .\scripts\new-worktree.ps1 -Name wt-1 -Branch feat/whatever
#>

param(
  [Parameter(Mandatory)][string]$Name,
  [Parameter(Mandatory)][string]$Branch,
  [int]$Port = 0,
  # Outside OneDrive by default, and derived rather than hardcoded so the script
  # is not one developer's machine committed to the repo. FORSETI_WT_ROOT wins if
  # set, so a second disk or a shorter path costs an env var, not a patch.
  [string]$Root = $(
    if ($env:FORSETI_WT_ROOT) { $env:FORSETI_WT_ROOT }
    else { Join-Path $env:USERPROFILE "code\forseti-wt" }
  )
)

$ErrorActionPreference = "Stop"

# git and npm both write ordinary progress to stderr. Under $ErrorActionPreference
# = "Stop", a caller who redirects that stream - `.\new-worktree.ps1 ... 2>&1 |
# tee`, or any CI wrapper - turns those lines into a terminating
# NativeCommandError on a run that actually succeeded. So exit codes decide
# whether a native command failed, and the preference is lifted around it.
function Invoke-Native {
  param([Parameter(Mandatory)][scriptblock]$Command, [Parameter(Mandatory)][string]$What)
  $prior = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try { & $Command } finally { $ErrorActionPreference = $prior }
  if ($LASTEXITCODE -ne 0) { throw "$What failed (exit $LASTEXITCODE)." }
}

$repo = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $Root $Name

# wt-1 -> 3001, wt-2 -> 3002. A name with no digit has to say its own port,
# because two dev servers silently fighting over 3000 is the thing this avoids.
if ($Port -eq 0) {
  $digits = ($Name -replace '\D', '')
  if ([string]::IsNullOrEmpty($digits)) {
    throw "Cannot derive a port from '$Name'. Pass -Port explicitly."
  }
  $Port = 3000 + [int]$digits
}

# Usually a leftover rather than a live worktree: `git worktree remove` cannot
# unlink .next on Windows while anything still holds a handle on it, so it
# reports success and leaves an empty directory behind. Say which it is, because
# "already exists" on a name you know you removed reads as a bug in the script.
if (Test-Path $dest) {
  $live = (git -C $repo worktree list --porcelain) -match [regex]::Escape($dest)
  if ($live) { throw "$dest is already a registered worktree. Remove it first: git -C `"$repo`" worktree remove $dest" }
  throw "$dest exists but git does not know it - a leftover from a previous removal. Delete it: Remove-Item -Recurse -Force $dest"
}
New-Item -ItemType Directory -Force -Path $Root | Out-Null

Invoke-Native { git -C $repo worktree add $dest -b $Branch } "git worktree add"

$envSrc = Join-Path $repo ".env.local"
if (Test-Path $envSrc) {
  $envDest = Join-Path $dest ".env.local"
  # Rewrite the origin to this worktree's port, or append it if the template
  # never set one: better-auth otherwise infers it from the Host header.
  $lines = @(Get-Content $envSrc)
  if ($lines -match '^BETTER_AUTH_URL=') {
    $lines = $lines -replace '^BETTER_AUTH_URL=.*', "BETTER_AUTH_URL=http://localhost:$Port"
  } else {
    $lines += "BETTER_AUTH_URL=http://localhost:$Port"
  }
  # Not Set-Content -Encoding utf8: on PowerShell 5.1 that writes a BOM, and
  # dotenv does not strip one. The BOM binds to the first line, so the file's
  # first key silently gains three leading bytes and stops resolving - here that
  # is ANTHROPIC_API_KEY, and the AI routes report it missing. Every other
  # variable loads fine, which is what makes it hard to see.
  [System.IO.File]::WriteAllLines($envDest, $lines, (New-Object System.Text.UTF8Encoding $false))
} else {
  Write-Warning "No .env.local in $repo. Copy .env.example and fill it in, or the app throws at import."
}

# One machine's permission grants, gitignored, and tedious to re-approve per worktree.
$settingsSrc = Join-Path $repo ".claude\settings.local.json"
if (Test-Path $settingsSrc) {
  New-Item -ItemType Directory -Force -Path (Join-Path $dest ".claude") | Out-Null
  Copy-Item $settingsSrc (Join-Path $dest ".claude\settings.local.json")
}

Push-Location $dest
try {
  Invoke-Native { npm ci } "npm ci in $dest"
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Ready: $dest" -ForegroundColor Green
Write-Host "  cd $dest"
Write-Host "  npm run dev -- -p $Port"
Write-Host ""
Write-Host "Migrations run from the main clone only: every worktree shares one DATABASE_URL."
Write-Host "When finished:  git -C `"$repo`" worktree remove $dest; git -C `"$repo`" branch -d $Branch"
