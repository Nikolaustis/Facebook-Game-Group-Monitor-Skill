param(
  [Parameter(Mandatory = $true)][string]$RunDir,
  [string]$ScheduledTaskName = '',
  [string]$RunnerStatusFile = ''
)

$ErrorActionPreference = 'Stop'

function Read-JsonSafe([string]$Path) {
  try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } catch { return $null }
}
function Write-JsonAtomic([string]$Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$Path.tmp-$PID-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
  $Payload | ConvertTo-Json -Depth 16 | Set-Content -LiteralPath $tmp -Encoding UTF8
  Move-Item -Force -LiteralPath $tmp -Destination $Path
}
function Test-UsableFile([string]$Path, [int64]$MinimumBytes = 2) {
  try { return (Test-Path -LiteralPath $Path -PathType Leaf) -and ((Get-Item -LiteralPath $Path).Length -ge $MinimumBytes) } catch { return $false }
}
function Convert-ToArgumentString([string[]]$Args) {
  return ($Args | ForEach-Object {
    $value = [string]$_
    if ($value -notmatch '[\s"]') { $value } else { '"' + ($value -replace '"','\"') + '"' }
  }) -join ' '
}
function Write-CoordinatorStatus([string]$Status, [hashtable]$Extra = @{}) {
  $payload = [ordered]@{
    coordinator_kind = 'facebook_group_monitor_verified_shutdown_coordinator'
    coordinator_version = 1
    coordinator_pid = $PID
    status = $Status
    run_dir = $RunDir
    scheduled_task_name = $ScheduledTaskName
    updated_at = (Get-Date).ToString('o')
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  Write-JsonAtomic $CoordinatorStatusFile $payload
  # Compatibility copy for dashboards/Codex routines that still look for the old watcher filename.
  try { Write-JsonAtomic $CompatibilityStatusFile $payload } catch {}
}
function Update-Completion([hashtable]$Changes) {
  $current = Read-JsonSafe $CompletionFile
  if (-not $current) { return }
  foreach ($key in $Changes.Keys) { $current | Add-Member -NotePropertyName $key -NotePropertyValue $Changes[$key] -Force }
  $current | Add-Member -NotePropertyName updated_at -NotePropertyValue (Get-Date).ToUniversalTime().ToString('o') -Force
  Write-JsonAtomic $CompletionFile $current
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
function Invoke-ForcedShutdown([int]$DelaySeconds, [string]$Comment) {
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
    $attempts.Add([ordered]@{ method='runner_powershell_direct_full_path'; exit_code=$code; output=($output -join "`n") }) | Out-Null
    if ($code -eq 0) { return [ordered]@{ ok=$true; method='runner_powershell_direct_full_path'; command="$shutdownExe $(Convert-ToArgumentString $shutdownArgs)"; attempts=$attempts } }
  } catch {
    $attempts.Add([ordered]@{ method='runner_powershell_direct_full_path'; error=$_.Exception.ToString() }) | Out-Null
  }

  try {
    $proc = Start-Process -FilePath $shutdownExe -ArgumentList (Convert-ToArgumentString $shutdownArgs) -WindowStyle Hidden -Wait -PassThru
    $attempts.Add([ordered]@{ method='runner_start_process_full_path'; exit_code=$proc.ExitCode }) | Out-Null
    if ($proc.ExitCode -eq 0) { return [ordered]@{ ok=$true; method='runner_start_process_full_path'; command="$shutdownExe $(Convert-ToArgumentString $shutdownArgs)"; attempts=$attempts } }
  } catch {
    $attempts.Add([ordered]@{ method='runner_start_process_full_path'; error=$_.Exception.ToString() }) | Out-Null
  }

  # Last resort: self-deleting one-shot scheduled task. It deletes its own task definition first.
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

$RunDir = [System.IO.Path]::GetFullPath($RunDir)
$CompletionFile = Join-Path $RunDir 'codex_task_complete.json'
$PolicyFile = Join-Path $RunDir 'shutdown_policy.json'
$OutXlsx = Join-Path $RunDir 'fb_monitoring_filtered.xlsx'
$OutSummary = Join-Path $RunDir 'fb_monitoring_filtered_summary.json'
$OutCollision = Join-Path $RunDir 'collision_report.json'
$OutAudit = Join-Path $RunDir 'audit_stats.json'
$OutDebugRows = Join-Path $RunDir 'debug_rows.json'
$OutCheckpoint = Join-Path $RunDir 'phase2_autosave_state.json'
$OutProgress = Join-Path $RunDir 'phase2_progress.json'
$CoordinatorStatusFile = Join-Path $RunDir 'shutdown_coordinator_status.json'
$CompatibilityStatusFile = Join-Path $RunDir 'conditional_shutdown_watcher_status.json'

try {
  Write-CoordinatorStatus 'coordinator_started' @{ message='Shutdown is blocked until strict finalization and current run policy are revalidated in the runner process.' }

  $completionData = Read-JsonSafe $CompletionFile
  $policy = Read-JsonSafe $PolicyFile
  $checkpoint = Read-JsonSafe $OutCheckpoint
  $progress = Read-JsonSafe $OutProgress

  $mode = if ($policy -and $policy.mode) { ([string]$policy.mode).Trim().ToLowerInvariant() } elseif ($completionData -and $completionData.shutdown_mode) { ([string]$completionData.shutdown_mode).Trim().ToLowerInvariant() } else { 'none' }
  $enabled = $mode -in @('after_complete','before_deadline')
  $delaySeconds = if ($policy -and $null -ne $policy.delay_seconds) { [Math]::Max(0,[int]$policy.delay_seconds) } elseif ($completionData -and $null -ne $completionData.shutdown_delay_seconds) { [Math]::Max(0,[int]$completionData.shutdown_delay_seconds) } else { 60 }
  $deadlineText = if ($mode -eq 'before_deadline' -and $policy) { [string]$policy.deadline } else { '' }
  $requestToken = if ($completionData) { [string]$completionData.shutdown_request_token } else { '' }

  if (-not $enabled) {
    Write-CoordinatorStatus 'shutdown_not_requested_policy_none' @{ shutdown_mode=$mode }
    Update-Completion @{ status='completed_no_shutdown_requested'; shutdown_requested=$false; shutdown_coordinator='runner'; shutdown_coordinator_status_file=$CoordinatorStatusFile }
    exit 0
  }

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
    shutdown_requested = [bool]($completionData -and $completionData.shutdown_requested -eq $true)
    shutdown_request_token_present = -not [string]::IsNullOrWhiteSpace($requestToken)
    coordinator_mode_runner = [bool]($completionData -and [string]$completionData.shutdown_coordinator_mode -eq 'runner')
  }
  $allValid = -not ($checks.Values -contains $false)
  if (-not $allValid) {
    Write-CoordinatorStatus 'shutdown_not_requested_validation_failed' @{ checks=$checks; shutdown_mode=$mode; completion_status=if($completionData){[string]$completionData.status}else{''} }
    Update-Completion @{ status='completed_shutdown_not_scheduled'; shutdown_requested=$true; shutdown_coordinator='runner'; shutdown_result=[ordered]@{ok=$false; requested=$false; reason='runner_validation_failed'; checks=$checks}; shutdown_coordinator_status_file=$CoordinatorStatusFile }
    exit 1
  }

  if ($mode -eq 'before_deadline') {
    if ([string]::IsNullOrWhiteSpace($deadlineText)) {
      Write-CoordinatorStatus 'shutdown_not_requested_invalid_deadline' @{ checks=$checks; shutdown_mode=$mode }
      Update-Completion @{ status='completed_shutdown_not_scheduled'; shutdown_result=[ordered]@{ok=$false; requested=$false; reason='missing_deadline'}; shutdown_coordinator_status_file=$CoordinatorStatusFile }
      exit 1
    }
    $deadline = [DateTimeOffset]::Parse($deadlineText)
    $completedText = if ($completionData.completed_at) { [string]$completionData.completed_at } else { [string]$completionData.updated_at }
    $completedAt = [DateTimeOffset]::Parse($completedText)
    if ($completedAt -ge $deadline) {
      Write-CoordinatorStatus 'complete_after_deadline_no_shutdown' @{ checks=$checks; completed_at=$completedAt.ToString('o'); deadline=$deadline.ToString('o') }
      Update-Completion @{ status='completed_after_deadline_no_shutdown'; shutdown_requested=$false; shutdown_result=[ordered]@{ok=$true; requested=$false; reason='completed_after_deadline'; completed_at=$completedAt.ToString('o'); deadline=$deadline.ToString('o')}; shutdown_coordinator_status_file=$CoordinatorStatusFile }
      exit 0
    }
  }

  $mainTaskCleanup = Remove-ScheduledTaskRobust $ScheduledTaskName
  Write-CoordinatorStatus 'issuing_forced_shutdown' @{ checks=$checks; main_task_cleanup=$mainTaskCleanup; shutdown_mode=$mode; delay_seconds=$delaySeconds; request_token=$requestToken }
  Update-Completion @{ status='completed_issuing_forced_shutdown'; shutdown_requested=$true; shutdown_coordinator='runner'; shutdown_coordinator_status_file=$CoordinatorStatusFile; shutdown_request_token=$requestToken }

  $result = Invoke-ForcedShutdown -DelaySeconds $delaySeconds -Comment 'FB group monitoring finished. System will shut down.'
  Write-CoordinatorStatus $(if($result.ok){'forced_shutdown_scheduled'}else{'forced_shutdown_not_scheduled'}) @{ checks=$checks; main_task_cleanup=$mainTaskCleanup; shutdown=$result; shutdown_mode=$mode; request_token=$requestToken }
  Update-Completion @{
    status = if($result.ok){'completed_forced_shutdown_scheduled'}else{'completed_shutdown_not_scheduled'}
    shutdown_requested = $true
    shutdown_coordinator = 'runner'
    shutdown_coordinator_status_file = $CoordinatorStatusFile
    shutdown_result = $result
    shutdown_request_token = $requestToken
  }
  if (-not $result.ok) { exit 1 }
  exit 0
} catch {
  $errorText = $_.Exception.ToString()
  try { Write-CoordinatorStatus 'coordinator_error' @{ error=$errorText } } catch {}
  try { Update-Completion @{ status='completed_shutdown_not_scheduled'; shutdown_result=[ordered]@{ok=$false; requested=$false; reason='shutdown_coordinator_error'; error=$errorText}; shutdown_coordinator='runner'; shutdown_coordinator_status_file=$CoordinatorStatusFile } } catch {}
  exit 1
}
