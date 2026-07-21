param(
  [Parameter(Mandatory = $true)][int]$WatchPid,
  [Parameter(Mandatory = $true)][string]$Completion,
  [Parameter(Mandatory = $true)][string]$OutXlsx,
  [Parameter(Mandatory = $true)][string]$OutSummary,
  [Parameter(Mandatory = $true)][string]$OutCollision,
  [Parameter(Mandatory = $true)][string]$OutAudit,
  [Parameter(Mandatory = $true)][string]$OutDebugRows,
  [Parameter(Mandatory = $true)][string]$OutCheckpoint,
  [Parameter(Mandatory = $true)][string]$OutProgress,
  [Parameter(Mandatory = $true)][string]$StatusFile,
  [Parameter(Mandatory = $true)][string]$Token,
  [int]$DelaySeconds = 60,
  [string]$Comment = 'FB group monitoring finished. System will shut down.',
  [string]$ShutdownBefore = '',
  [string]$ScheduledTaskName = ''
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-JsonSafe([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}
function Test-UsableFile([string]$Path, [int64]$MinimumBytes = 2) {
  try { return (Test-Path -LiteralPath $Path -PathType Leaf) -and ((Get-Item -LiteralPath $Path).Length -ge $MinimumBytes) } catch { return $false }
}
function Write-Status([string]$Status, [hashtable]$Extra = @{}) {
  $payload = [ordered]@{
    watcher_kind = 'facebook_group_monitor_conditional_shutdown_watcher'
    watcher_version = 4
    watcher_pid = $PID
    watch_pid = $WatchPid
    status = $Status
    shutdown_before = $ShutdownBefore
    scheduled_task_name = $ScheduledTaskName
    delay_seconds = [Math]::Max(0, $DelaySeconds)
    force_apps = $true
    updated_at = (Get-Date).ToString('o')
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $dir = Split-Path -Parent $StatusFile
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$StatusFile.tmp-$PID"
  Write-Utf8NoBom $tmp ($payload | ConvertTo-Json -Depth 12)
  Move-Item -Force -LiteralPath $tmp -Destination $StatusFile
}
function Convert-ToArgumentString([string[]]$Args) {
  return ($Args | ForEach-Object {
    $value = [string]$_
    if ($value -notmatch '[\s"]') { $value } else { '"' + ($value -replace '"','\"') + '"' }
  }) -join ' '
}
function Remove-ScheduledTaskRobust([string]$TaskName) {
  if ([string]::IsNullOrWhiteSpace($TaskName)) { return [ordered]@{ requested=$false; deleted=$true; reason='no_task_name' } }
  $attempts = New-Object System.Collections.Generic.List[object]
  try {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    $attempts.Add([ordered]@{ method='unregister_scheduled_task'; ok=$true }) | Out-Null
  } catch {
    $attempts.Add([ordered]@{ method='unregister_scheduled_task'; ok=$false; error=$_.Exception.Message }) | Out-Null
  }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    try {
      & schtasks.exe /Delete /TN $TaskName /F *> $null
      $attempts.Add([ordered]@{ method='schtasks_delete'; exit_code=$LASTEXITCODE }) | Out-Null
    } catch {
      $attempts.Add([ordered]@{ method='schtasks_delete'; error=$_.Exception.Message }) | Out-Null
    }
  }
  $deleted = -not [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
  return [ordered]@{ requested=$true; deleted=$deleted; task_name=$TaskName; attempts=$attempts }
}

function Start-DeferredTaskCleanup([string]$TaskName) {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $ps)) { $ps = 'powershell.exe' }
  $escaped = $TaskName.Replace("'", "''")
  $cmd = "Start-Sleep -Seconds 30; Unregister-ScheduledTask -TaskName '$escaped' -Confirm:`$false -ErrorAction SilentlyContinue; if (Get-ScheduledTask -TaskName '$escaped' -ErrorAction SilentlyContinue) { & schtasks.exe /Delete /TN '$escaped' /F *> `$null }"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $ps
  $psi.Arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $encoded"
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  [void][System.Diagnostics.Process]::Start($psi)
}
function Invoke-ForcedShutdown {
  $shutdownExe = Join-Path $env:SystemRoot 'System32\shutdown.exe'
  if (-not (Test-Path -LiteralPath $shutdownExe)) { $shutdownExe = 'shutdown.exe' }
  $safeDelay = [Math]::Max(0, $DelaySeconds)
  $safeComment = ([string]$Comment).Replace("`r", ' ').Replace("`n", ' ')
  if ($safeComment.Length -gt 512) { $safeComment = $safeComment.Substring(0,512) }
  $shutdownArgs = @('/s','/f','/t',[string]$safeDelay,'/d','p:0:0','/c',$safeComment)
  $attempts = New-Object System.Collections.Generic.List[object]

  try {
    $output = & $shutdownExe @shutdownArgs 2>&1
    $code = $LASTEXITCODE
    $attempts.Add([ordered]@{ method='powershell_direct_full_path'; exit_code=$code; output=($output -join "`n") }) | Out-Null
    if ($code -eq 0) { return [ordered]@{ ok=$true; method='powershell_direct_full_path'; command="$shutdownExe $(Convert-ToArgumentString $shutdownArgs)"; attempts=$attempts } }
  } catch {
    $attempts.Add([ordered]@{ method='powershell_direct_full_path'; error=$_.Exception.ToString() }) | Out-Null
  }

  try {
    $proc = Start-Process -FilePath $shutdownExe -ArgumentList (Convert-ToArgumentString $shutdownArgs) -WindowStyle Hidden -Wait -PassThru
    $attempts.Add([ordered]@{ method='start_process_full_path'; exit_code=$proc.ExitCode }) | Out-Null
    if ($proc.ExitCode -eq 0) { return [ordered]@{ ok=$true; method='start_process_full_path'; command="$shutdownExe $(Convert-ToArgumentString $shutdownArgs)"; attempts=$attempts } }
  } catch {
    $attempts.Add([ordered]@{ method='start_process_full_path'; error=$_.Exception.ToString() }) | Out-Null
  }

  # Last resort: an immediately started, self-deleting Task Scheduler shutdown task.
  $taskName = 'FBGroupMonitor_Shutdown_' + ([Guid]::NewGuid().ToString('N').Substring(0,16))
  foreach ($runLevel in @('Highest','Limited')) {
    try {
      $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
      $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      if (-not (Test-Path -LiteralPath $psExe)) { $psExe = 'powershell.exe' }
      $escapedTask = $taskName.Replace("'", "''")
      $escapedShutdown = ([string]$shutdownExe).Replace("'", "''")
      $shutdownLiteralArgs = ($shutdownArgs | ForEach-Object { "'" + ([string]$_).Replace("'", "''") + "'" }) -join ','
      $selfDeleteAndShutdown = @"
`$ErrorActionPreference='SilentlyContinue'
try { Unregister-ScheduledTask -TaskName '$escapedTask' -Confirm:`$false -ErrorAction SilentlyContinue } catch {}
if (Get-ScheduledTask -TaskName '$escapedTask' -ErrorAction SilentlyContinue) { & schtasks.exe /Delete /TN '$escapedTask' /F *> `$null }
& '$escapedShutdown' @($shutdownLiteralArgs)
exit `$LASTEXITCODE
"@
      $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($selfDeleteAndShutdown))
      $actionArgs = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -EncodedCommand $encodedCommand"
      $action = New-ScheduledTaskAction -Execute $psExe -Argument $actionArgs
      $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
      $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::FromMinutes(5))
      $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel $runLevel
      Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'One-shot FB Group Monitor forced shutdown; self-deletes before shutdown.' -Force | Out-Null
      Start-ScheduledTask -TaskName $taskName
      Start-DeferredTaskCleanup $taskName
      $attempts.Add([ordered]@{ method='self_deleting_shutdown_task'; run_level=$runLevel; task_name=$taskName; started=$true }) | Out-Null
      return [ordered]@{ ok=$true; method='self_deleting_shutdown_task'; task_name=$taskName; self_delete=$true; attempts=$attempts }
    } catch {
      $attempts.Add([ordered]@{ method='self_deleting_shutdown_task'; run_level=$runLevel; task_name=$taskName; error=$_.Exception.ToString() }) | Out-Null
      try { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
    }
  }
  return [ordered]@{ ok=$false; method='all_methods_failed'; attempts=$attempts }
}

try {
  Write-Status 'watching_phase2_process' @{ message='Waiting for phase 2 to exit. Shutdown remains blocked until strict finalization validation succeeds.' }
  while (Get-Process -Id $WatchPid -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }

  # WaitPid is the scheduled/direct PowerShell runner, not only Node. At this point the
  # runner has completed its own finally block. Clean the deterministic task once more
  # before any immediate shutdown to prevent stale Task Scheduler entries.
  $mainTaskCleanup = Remove-ScheduledTaskRobust $ScheduledTaskName

  $completionData = Read-JsonSafe $Completion
  $checkpoint = Read-JsonSafe $OutCheckpoint
  $progress = Read-JsonSafe $OutProgress
  $checks = [ordered]@{
    final_xlsx = Test-UsableFile $OutXlsx 1024
    summary_json = Test-UsableFile $OutSummary 2
    collision_json = Test-UsableFile $OutCollision 2
    audit_json = Test-UsableFile $OutAudit 2
    debug_rows_json = Test-UsableFile $OutDebugRows 2
    checkpoint_finalized = [bool]($checkpoint -and $checkpoint.finalized -eq $true)
    progress_finalized = [bool]($progress -and $progress.finalized -eq $true)
    completion_verified = [bool]($completionData -and $completionData.phase2_finalization_verified -eq $true)
    final_report_generated = [bool]($completionData -and $completionData.final_report_generated -eq $true)
    report_created = [bool]($completionData -and $completionData.report_created -eq $true)
    chrome_closed = [bool]($completionData -and $completionData.chrome_closed -eq $true)
    watcher_token_matches = [bool]($completionData -and ([string]$completionData.shutdown_watcher_token -eq $Token))
  }
  $allValid = -not ($checks.Values -contains $false)
  if (-not $allValid) {
    Write-Status 'shutdown_not_requested_validation_failed' @{ checks=$checks; main_task_cleanup=$mainTaskCleanup; completion_status=if($completionData){[string]$completionData.status}else{''} }
    exit 1
  }

  if (-not [string]::IsNullOrWhiteSpace($ShutdownBefore)) {
    $deadline = [DateTimeOffset]::Parse($ShutdownBefore)
    $completedText = if ($completionData.completed_at) { [string]$completionData.completed_at } else { [string]$completionData.updated_at }
    $completedAt = [DateTimeOffset]::Parse($completedText)
    if ($completedAt -ge $deadline) {
      Write-Status 'complete_after_deadline_no_shutdown' @{ checks=$checks; main_task_cleanup=$mainTaskCleanup; completed_at=$completedAt.ToString('o'); deadline=$deadline.ToString('o') }
      exit 0
    }
  }

  Write-Status 'issuing_forced_shutdown' @{ checks=$checks; main_task_cleanup=$mainTaskCleanup; completed_at=[string]$completionData.completed_at }
  $result = Invoke-ForcedShutdown
  Write-Status $(if($result.ok){'forced_shutdown_scheduled'}else{'forced_shutdown_not_scheduled'}) @{ checks=$checks; main_task_cleanup=$mainTaskCleanup; shutdown=$result; completed_at=[string]$completionData.completed_at }
  if (-not $result.ok) { exit 1 }
} catch {
  Write-Status 'watcher_error' @{ error=$_.Exception.ToString() }
  exit 1
}
