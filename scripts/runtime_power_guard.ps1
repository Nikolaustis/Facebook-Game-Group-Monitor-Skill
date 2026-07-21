param(
  [Parameter(Mandatory = $true)][string]$RunDir,
  [Parameter(Mandatory = $true)][int]$ParentPid,
  [int]$PollSeconds = 5
)

$ErrorActionPreference = 'SilentlyContinue'

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}
$RunDir = [System.IO.Path]::GetFullPath($RunDir)
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
$StatusFile = Join-Path $RunDir 'runtime_power_guard_status.json'
$StopFile = Join-Path $RunDir 'runtime_power_guard.stop'
Remove-Item -Force -LiteralPath $StopFile -ErrorAction SilentlyContinue

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FBMonitorPowerGuard {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_AWAYMODE_REQUIRED = 0x00000040;
}
"@

function Write-GuardStatus([string]$Status, [hashtable]$Extra = @{}) {
  $payload = [ordered]@{
    guard_kind = 'facebook_group_monitor_runtime_power_guard'
    guard_version = 1
    status = $Status
    guard_pid = $PID
    parent_pid = $ParentPid
    run_dir = $RunDir
    prevents_sleep = $true
    cancels_pending_shutdown = $true
    limitation = 'User-space protection cannot override an immediate kernel, firmware, administrator, or non-cancellable Windows Update restart.'
    updated_at = (Get-Date).ToString('o')
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $tmp = "$StatusFile.tmp-$PID"
  Write-Utf8NoBom $tmp ($payload | ConvertTo-Json -Depth 6)
  Move-Item -Force -LiteralPath $tmp -Destination $StatusFile
}

$startedAt = Get-Date
$abortCount = 0
$stopRequested = $false
Write-GuardStatus 'active' @{ started_at = $startedAt.ToString('o'); shutdown_abort_successes = 0 }

try {
  [void][FBMonitorPowerGuard]::SetThreadExecutionState(
    [FBMonitorPowerGuard]::ES_CONTINUOUS -bor
    [FBMonitorPowerGuard]::ES_SYSTEM_REQUIRED -bor
    [FBMonitorPowerGuard]::ES_AWAYMODE_REQUIRED
  )

  while ((Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and -not (Test-Path -LiteralPath $StopFile)) {
    # Cancel any pending user-mode shutdown/restart while phase 2 is active.
    & shutdown.exe /a *> $null
    if ($LASTEXITCODE -eq 0) {
      $abortCount++
      Write-GuardStatus 'pending_shutdown_cancelled' @{
        started_at = $startedAt.ToString('o')
        shutdown_abort_successes = $abortCount
        last_shutdown_abort_at = (Get-Date).ToString('o')
      }
    }

    [void][FBMonitorPowerGuard]::SetThreadExecutionState(
      [FBMonitorPowerGuard]::ES_CONTINUOUS -bor
      [FBMonitorPowerGuard]::ES_SYSTEM_REQUIRED -bor
      [FBMonitorPowerGuard]::ES_AWAYMODE_REQUIRED
    )
    Start-Sleep -Seconds ([Math]::Max(2, $PollSeconds))
  }
  $stopRequested = Test-Path -LiteralPath $StopFile
}
finally {
  [void][FBMonitorPowerGuard]::SetThreadExecutionState([FBMonitorPowerGuard]::ES_CONTINUOUS)
  Write-GuardStatus 'stopped' @{
    started_at = $startedAt.ToString('o')
    stopped_at = (Get-Date).ToString('o')
    shutdown_abort_successes = $abortCount
    reason = if ($stopRequested) { 'stop_requested' } else { 'parent_process_not_running' }
  }
  Remove-Item -Force -LiteralPath $StopFile -ErrorAction SilentlyContinue
}
