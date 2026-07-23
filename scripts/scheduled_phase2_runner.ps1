param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$TaskName
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-JsonAtomic([string]$Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$Path.tmp-$PID-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
  Write-Utf8NoBom $tmp ($Payload | ConvertTo-Json -Depth 10)
  Move-Item -Force -LiteralPath $tmp -Destination $Path
}

function Test-Cdp([string]$Cdp) {
  try {
    $uri = $Cdp.TrimEnd('/') + '/json/version'
    $result = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 5
    return [bool]$result.webSocketDebuggerUrl
  } catch {
    return $false
  }
}

function Add-RunnerStatusFields([string]$Path, [hashtable]$Fields) {
  try {
    $payload = if (Test-Path -LiteralPath $Path) { Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } else { [pscustomobject]@{} }
    foreach ($key in $Fields.Keys) { $payload | Add-Member -NotePropertyName $key -NotePropertyValue $Fields[$key] -Force }
    $payload | Add-Member -NotePropertyName updated_at -NotePropertyValue (Get-Date).ToString('o') -Force
    Write-JsonAtomic $Path $payload
  } catch {}
}

function ConvertTo-NativeQuotedArgument([string]$Value) {
  if ($null -eq $Value) { return '""' }
  # Windows command-line quoting compatible with CommandLineToArgvW rules.
  $text = [string]$Value
  if ($text -notmatch '[\s"]') { return $text }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($ch in $text.ToCharArray()) {
    if ($ch -eq '\') {
      $backslashes++
      continue
    }
    if ($ch -eq '"') {
      [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) {
      [void]$builder.Append(('\' * $backslashes))
      $backslashes = 0
    }
    [void]$builder.Append($ch)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Start-HiddenPowerShellProcess([string]$ScriptPath, [string[]]$ScriptArguments = @()) {
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($fixed in @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$ScriptPath)) {
    $parts.Add((ConvertTo-NativeQuotedArgument ([string]$fixed))) | Out-Null
  }
  foreach ($item in $ScriptArguments) {
    $parts.Add((ConvertTo-NativeQuotedArgument ([string]$item))) | Out-Null
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'powershell.exe'
  $psi.Arguments = ($parts -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw "Failed to start hidden PowerShell process: $ScriptPath" }
  return $process
}

function Remove-OwnScheduledTaskNow([string]$Name, [string]$ManifestPath, [string]$StatusPath, [string]$BootstrapPath = '') {
  $deleted = $false
  try {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop
  } catch {
    # schtasks.exe can delete the task definition even while its current action is winding down.
    try { & schtasks.exe /Delete /TN $Name /F *> $null } catch {}
  }
  $deleted = -not [bool](Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue)
  try {
    $status = Get-Content -Raw -LiteralPath $StatusPath | ConvertFrom-Json
    $status | Add-Member -NotePropertyName scheduled_task_deleted -NotePropertyValue $deleted -Force
    $status | Add-Member -NotePropertyName scheduled_task_deleted_at -NotePropertyValue (Get-Date).ToString('o') -Force
    Write-Utf8NoBom $StatusPath ($status | ConvertTo-Json -Depth 10)
  } catch {}
  if ($deleted) {
    Remove-Item -Force -LiteralPath $ManifestPath -ErrorAction SilentlyContinue
    if (-not [string]::IsNullOrWhiteSpace($BootstrapPath)) { Remove-Item -Force -LiteralPath $BootstrapPath -ErrorAction SilentlyContinue }
  }
  return $deleted
}

function Start-DeferredTaskCleanup([string]$Name, [string]$ManifestPath, [string]$StatusPath, [string]$BootstrapPath = '') {
  $escapedName = $Name.Replace("'", "''")
  $escapedManifest = $ManifestPath.Replace("'", "''")
  $escapedStatus = $StatusPath.Replace("'", "''")
  $escapedBootstrap = $BootstrapPath.Replace("'", "''")
  $parent = $PID
  $command = @"
`$ErrorActionPreference='SilentlyContinue'
while (Get-Process -Id $parent -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }
Unregister-ScheduledTask -TaskName '$escapedName' -Confirm:`$false -ErrorAction SilentlyContinue
if (Get-ScheduledTask -TaskName '$escapedName' -ErrorAction SilentlyContinue) { & schtasks.exe /Delete /TN '$escapedName' /F *> `$null }
`$deleted = -not [bool](Get-ScheduledTask -TaskName '$escapedName' -ErrorAction SilentlyContinue)
try {
  `$status = Get-Content -Raw -LiteralPath '$escapedStatus' | ConvertFrom-Json
  `$status | Add-Member -NotePropertyName scheduled_task_deleted -NotePropertyValue `$deleted -Force
  `$status | Add-Member -NotePropertyName scheduled_task_deleted_at -NotePropertyValue (Get-Date).ToString('o') -Force
  [System.IO.File]::WriteAllText('$escapedStatus', (`$status | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding(`$false)))
} catch {}
if (`$deleted) {
  Remove-Item -Force -LiteralPath '$escapedManifest' -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace('$escapedBootstrap')) { Remove-Item -Force -LiteralPath '$escapedBootstrap' -ErrorAction SilentlyContinue }
}
"@
  $cleanupScript = Join-Path (Split-Path -Parent $StatusPath) ("scheduled_task_cleanup_{0}.ps1" -f ([Guid]::NewGuid().ToString('N')))
  Write-Utf8NoBom $cleanupScript ($command + "`nRemove-Item -Force -LiteralPath '" + $cleanupScript.Replace("'", "''") + "' -ErrorAction SilentlyContinue")
  [void](Start-HiddenPowerShellProcess -ScriptPath $cleanupScript)
}

$Manifest = [System.IO.Path]::GetFullPath($Manifest)
if (-not (Test-Path -LiteralPath $Manifest)) { throw "Task manifest not found: $Manifest" }
$m = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
$runFreshStart = [bool]$m.fresh_start
$RootDir = [System.IO.Path]::GetFullPath([string]$m.root_dir)
$RunDir = [System.IO.Path]::GetFullPath([string]$m.run_dir)
$StatusFile = Join-Path $RunDir 'background_task.json'
$RunnerStatus = Join-Path $RunDir 'scheduled_phase2_runner_status.json'
$StdoutLog = [string]$m.stdout_log
$StderrLog = [string]$m.stderr_log
$SupervisorStdoutLog = if ([string]::IsNullOrWhiteSpace([string]$m.supervisor_stdout_log)) { Join-Path $RunDir 'phase2_supervisor.stdout.log' } else { [string]$m.supervisor_stdout_log }
$SupervisorStderrLog = if ([string]::IsNullOrWhiteSpace([string]$m.supervisor_stderr_log)) { Join-Path $RunDir 'phase2_supervisor.stderr.log' } else { [string]$m.supervisor_stderr_log }
if ([System.StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFullPath($SupervisorStdoutLog), [System.IO.Path]::GetFullPath($StdoutLog))) {
  $SupervisorStdoutLog = Join-Path $RunDir 'phase2_supervisor.stdout.log'
}
if ([System.StringComparer]::OrdinalIgnoreCase.Equals([System.IO.Path]::GetFullPath($SupervisorStderrLog), [System.IO.Path]::GetFullPath($StderrLog))) {
  $SupervisorStderrLog = Join-Path $RunDir 'phase2_supervisor.stderr.log'
}
$BootstrapPath = [string]$m.bootstrap_script
$LauncherMode = if ([string]::IsNullOrWhiteSpace([string]$m.launcher_mode)) { 'legacy_task_scheduler' } else { [string]$m.launcher_mode }
$lockName = 'Local\FBGroupMonitor_' + (($TaskName -replace '[^A-Za-z0-9_]', '_'))
$mutex = New-Object System.Threading.Mutex($false, $lockName)
$lockAcquired = $false
$guardProcess = $null
$exitCode = 1
$normalRunnerExit = $false
$nodePhase2Executed = $false
$shutdownCoordinatorExitCode = $null
$ShutdownCoordinatorScript = Join-Path $RootDir 'scripts\verified_shutdown_coordinator.ps1'
$ShutdownCoordinatorStdout = Join-Path $RunDir 'shutdown_coordinator.stdout.log'
$ShutdownCoordinatorStderr = Join-Path $RunDir 'shutdown_coordinator.stderr.log'

try {
  $lockAcquired = $mutex.WaitOne(0)
  if (-not $lockAcquired) {
    Write-JsonAtomic $RunnerStatus ([ordered]@{
      status = 'duplicate_instance_ignored'
      task_name = $TaskName
      runner_pid = $PID
      updated_at = (Get-Date).ToString('o')
      scheduled_task_deleted = $false
    })
    exit 0
  }

  # FreshStart is a one-shot launch instruction. Clear it in the persistent manifest before
  # starting phase 2 so a later reboot resumes the newly created checkpoint instead of restarting again.
  if ($runFreshStart) {
    $m.fresh_start = $false
    Write-JsonAtomic $Manifest $m
  }

  Set-Location -LiteralPath $RootDir
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
  Add-Content -LiteralPath $StdoutLog -Value "[scheduled] started_at=$((Get-Date).ToString('o')) task_name=$TaskName run_dir=$RunDir"

  $completionFile = Join-Path $RunDir 'codex_task_complete.json'
  if ((Test-Path -LiteralPath $completionFile) -and (Test-Path -LiteralPath ([string]$m.out_xlsx))) {
    try {
      $completed = Get-Content -Raw -LiteralPath $completionFile | ConvertFrom-Json
      if ($completed.final_report_generated -eq $true -and $completed.phase2_finalization_verified -eq $true) {
        $normalRunnerExit = $true
        $exitCode = 0
        Write-JsonAtomic $RunnerStatus ([ordered]@{
          status = 'already_completed_noop'
          task_name = $TaskName
          runner_pid = $PID
          run_dir = $RunDir
          completed_at = (Get-Date).ToString('o')
          scheduled_task_deleted = $false
        })
        exit 0
      }
    } catch {}
  }

  Write-JsonAtomic $RunnerStatus ([ordered]@{
    status = 'starting'
    task_name = $TaskName
    runner_pid = $PID
    manifest = $Manifest
    run_dir = $RunDir
    shutdown_mode = [string]$m.shutdown_mode
    shutdown_policy_file = [string]$m.shutdown_policy_file
    started_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
    launcher = $LauncherMode
    powershell_window_visible = $false
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    supervisor_stdout_log = $SupervisorStdoutLog
    supervisor_stderr_log = $SupervisorStderrLog
  })

  $inputValidation = if ([string]::IsNullOrWhiteSpace([string]$m.input_validation_report)) { Join-Path $RunDir 'phase2_input_validation.json' } else { [string]$m.input_validation_report }
  $validationArgs = @((Join-Path $RootDir 'scripts\validate_phase2_inputs.js'),'--index',[string]$m.index,'--out-report',$inputValidation)
  if (-not [string]::IsNullOrWhiteSpace([string]$m.config)) { $validationArgs += @('--config',[string]$m.config) }
  if (-not [string]::IsNullOrWhiteSpace([string]$m.shutdown_policy_file)) { $validationArgs += @('--shutdown-policy-file',[string]$m.shutdown_policy_file) }
  & node @validationArgs 1>> $StdoutLog 2>> $StderrLog
  if ($LASTEXITCODE -ne 0) { throw "Phase 2 input validation failed. See: $inputValidation" }
  Add-RunnerStatusFields $RunnerStatus @{ input_validation_ok = $true; input_validation_report = $inputValidation }

  # Start the power guard before opening Chrome or waiting for CDP. The whole scheduled
  # execution, including browser startup, is protected against sleep and cancellable shutdowns.
  if ([bool]$m.enable_power_guard) {
    $guardScript = Join-Path $RootDir 'scripts\runtime_power_guard.ps1'
    if (Test-Path -LiteralPath $guardScript) {
      $guardProcess = Start-HiddenPowerShellProcess -ScriptPath $guardScript -ScriptArguments @(
        '-RunDir',$RunDir,'-ParentPid',[string]$PID,'-PollSeconds',[string]$m.power_guard_poll_seconds
      )
    }
  }

  if (-not (Test-Cdp ([string]$m.cdp))) {
    $openChrome = Join-Path $RootDir 'scripts\open_chrome_9222.ps1'
    if (Test-Path -LiteralPath $openChrome) {
      # Invoke the launcher script inside this already-hidden runner. Spawning a new
      # powershell.exe here could briefly create an interactive console on some systems.
      & $openChrome -Cdp ([string]$m.cdp) 1>> $StdoutLog 2>> $StderrLog
    }
    $deadline = (Get-Date).AddSeconds([Math]::Max(30, [int]$m.chrome_start_timeout_seconds))
    while ((Get-Date) -lt $deadline -and -not (Test-Cdp ([string]$m.cdp))) { Start-Sleep -Seconds 2 }
  }
  if (-not (Test-Cdp ([string]$m.cdp))) {
    throw "Chrome CDP is unavailable after automatic launch attempt: $($m.cdp)"
  }

  $nodeArgs = New-Object System.Collections.Generic.List[string]
  $nodeArgs.Add((Join-Path $RootDir 'scripts\phase2_collect_details.js')) | Out-Null
  foreach ($pair in @(
    @('--index', [string]$m.index),
    @('--threshold', [string]$m.threshold),
    @('--out-xlsx', [string]$m.out_xlsx),
    @('--out-summary', [string]$m.out_summary),
    @('--out-collision', [string]$m.out_collision),
    @('--out-audit', [string]$m.out_audit),
    @('--out-debug-rows', [string]$m.out_debug_rows),
    @('--cdp', [string]$m.cdp),
    @('--progress-report-every-minutes', [string]$m.progress_report_every_minutes)
  )) {
    $nodeArgs.Add($pair[0]) | Out-Null
    $nodeArgs.Add($pair[1]) | Out-Null
  }
  if ([bool]$m.no_close_chrome) { $nodeArgs.Add('--no-close-chrome') | Out-Null; $nodeArgs.Add('true') | Out-Null }
  if ($runFreshStart) { $nodeArgs.Add('--fresh-start') | Out-Null; $nodeArgs.Add('true') | Out-Null }
  $nodeArgs.Add('--shutdown-wait-pid') | Out-Null; $nodeArgs.Add([string]$PID) | Out-Null
  $nodeArgs.Add('--scheduled-task-name') | Out-Null; $nodeArgs.Add([string]$TaskName) | Out-Null
  $nodeArgs.Add('--shutdown-coordinator-mode') | Out-Null; $nodeArgs.Add('runner') | Out-Null
  if (-not [string]::IsNullOrWhiteSpace([string]$m.shutdown_policy_file)) {
    $nodeArgs.Add('--shutdown-policy-file') | Out-Null; $nodeArgs.Add([string]$m.shutdown_policy_file) | Out-Null
  } elseif ([bool]$m.shutdown_after_complete -or -not [string]::IsNullOrWhiteSpace([string]$m.shutdown_before)) {
    # Backward compatibility for older manifests.
    $nodeArgs.Add('--shutdown-after-complete') | Out-Null; $nodeArgs.Add('true') | Out-Null
    $nodeArgs.Add('--shutdown-delay-seconds') | Out-Null; $nodeArgs.Add([string]$m.shutdown_delay_seconds) | Out-Null
    if (-not [string]::IsNullOrWhiteSpace([string]$m.shutdown_before)) {
      $nodeArgs.Add('--shutdown-before') | Out-Null; $nodeArgs.Add([string]$m.shutdown_before) | Out-Null
    }
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$m.config)) {
    $nodeArgs.Add('--config') | Out-Null; $nodeArgs.Add([string]$m.config) | Out-Null
  }

  Write-JsonAtomic $RunnerStatus ([ordered]@{
    status = 'phase2_launching'
    task_name = $TaskName
    runner_pid = $PID
    power_guard_pid = if ($guardProcess) { $guardProcess.Id } else { $null }
    run_dir = $RunDir
    started_at = (Get-Date).ToString('o')
    startup_verified = $false
    scheduled_task_deleted = $false
    launcher = $LauncherMode
    powershell_window_visible = $false
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    supervisor_stdout_log = $SupervisorStdoutLog
    supervisor_stderr_log = $SupervisorStderrLog
  })

  $supervisorArgs = New-Object System.Collections.Generic.List[string]
  $supervisorArgs.Add((Join-Path $RootDir 'scripts\phase2_supervisor.js')) | Out-Null
  foreach ($pair in @(
    @('--runner-status', $RunnerStatus),
    @('--progress-file', (Join-Path $RunDir 'phase2_progress.json')),
    @('--stdout-log', $StdoutLog),
    @('--stderr-log', $StderrLog),
    @('--startup-timeout-seconds', [string]([Math]::Max(30, [int]$m.phase2_health_timeout_seconds)))
  )) {
    $supervisorArgs.Add([string]$pair[0]) | Out-Null
    $supervisorArgs.Add([string]$pair[1]) | Out-Null
  }
  $supervisorArgs.Add('--') | Out-Null
  foreach ($item in $nodeArgs) { $supervisorArgs.Add([string]$item) | Out-Null }

  $nodePhase2Executed = $true
  # The supervisor opens $StdoutLog and $StderrLog itself so it can pipe the
  # phase-2 child into them. Redirecting the supervisor process to those same
  # files makes Windows PowerShell hold conflicting append handles and causes
  # Node's WriteStream to fail before a progress checkpoint can be written.
  & node @supervisorArgs 1>> $SupervisorStdoutLog 2>> $SupervisorStderrLog
  $exitCode = $LASTEXITCODE
  $normalRunnerExit = $true
  Add-Content -LiteralPath $StdoutLog -Value "[scheduled] finished_at=$((Get-Date).ToString('o')) exit_code=$exitCode"

  Add-RunnerStatusFields $RunnerStatus @{
    status = if ($exitCode -eq 0) { 'finished_success' } else { 'finished_error' }
    task_name = $TaskName
    runner_pid = $PID
    exit_code = $exitCode
    run_dir = $RunDir
    shutdown_mode = [string]$m.shutdown_mode
    shutdown_policy_file = [string]$m.shutdown_policy_file
    finished_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    supervisor_stdout_log = $SupervisorStdoutLog
    supervisor_stderr_log = $SupervisorStderrLog
  }
}
catch {
  $normalRunnerExit = $true
  $exitCode = 1
  $message = $_.Exception.ToString()
  Add-Content -LiteralPath $StderrLog -Value "[scheduled] fatal_at=$((Get-Date).ToString('o'))`n$message"
  Write-JsonAtomic $RunnerStatus ([ordered]@{
    status = 'runner_error'
    task_name = $TaskName
    runner_pid = $PID
    exit_code = 1
    error = $message
    run_dir = $RunDir
    shutdown_mode = [string]$m.shutdown_mode
    shutdown_policy_file = [string]$m.shutdown_policy_file
    finished_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    supervisor_stdout_log = $SupervisorStdoutLog
    supervisor_stderr_log = $SupervisorStderrLog
  })
}
finally {
  if ($guardProcess -and -not $guardProcess.HasExited) {
    $guardStopFile = Join-Path $RunDir 'runtime_power_guard.stop'
    try { Write-Utf8NoBom $guardStopFile ((Get-Date).ToString('o')) } catch {}
    try { Wait-Process -Id $guardProcess.Id -Timeout 12 -ErrorAction SilentlyContinue } catch {}
    if (Get-Process -Id $guardProcess.Id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $guardProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
  if ($lockAcquired) {
    try { $mutex.ReleaseMutex() | Out-Null } catch {}
  }
  $mutex.Dispose()

  # A reboot kills this process before finally executes, so the task remains and its AtLogOn trigger resumes it.
  # Every normal execution end, success or error, schedules immediate self-deletion to avoid stale tasks.
  if ($normalRunnerExit -and $lockAcquired) {
    $deletedNow = Remove-OwnScheduledTaskNow -Name $TaskName -ManifestPath $Manifest -StatusPath $RunnerStatus -BootstrapPath $BootstrapPath
    if (-not $deletedNow) {
      Start-DeferredTaskCleanup -Name $TaskName -ManifestPath $Manifest -StatusPath $RunnerStatus -BootstrapPath $BootstrapPath
    }

    # The already-running hidden PowerShell runner is the shutdown coordinator.
    # This avoids spawning a detached watcher that can receive a PID but die before its first log/status write.
    if ($nodePhase2Executed -and $exitCode -eq 0 -and (Test-Path -LiteralPath $ShutdownCoordinatorScript)) {
      try {
        & $ShutdownCoordinatorScript -RunDir $RunDir -ScheduledTaskName $TaskName -RunnerStatusFile $RunnerStatus 1>> $ShutdownCoordinatorStdout 2>> $ShutdownCoordinatorStderr
        $shutdownCoordinatorExitCode = $LASTEXITCODE
        Add-RunnerStatusFields $RunnerStatus @{
          shutdown_coordinator = 'runner_in_process'
          shutdown_coordinator_exit_code = $shutdownCoordinatorExitCode
          shutdown_coordinator_stdout = $ShutdownCoordinatorStdout
          shutdown_coordinator_stderr = $ShutdownCoordinatorStderr
          shutdown_coordinator_status = (Join-Path $RunDir 'shutdown_coordinator_status.json')
        }
      } catch {
        $shutdownCoordinatorExitCode = 1
        Add-Content -LiteralPath $ShutdownCoordinatorStderr -Value "[shutdown-coordinator] fatal_at=$((Get-Date).ToString('o'))`n$($_.Exception.ToString())"
        Add-RunnerStatusFields $RunnerStatus @{
          shutdown_coordinator = 'runner_in_process'
          shutdown_coordinator_exit_code = 1
          shutdown_coordinator_error = $_.Exception.ToString()
          shutdown_coordinator_status = (Join-Path $RunDir 'shutdown_coordinator_status.json')
        }
      }
    }
  }
}

exit $exitCode
