param(
  [Parameter(Mandatory = $true)][string]$Manifest,
  [Parameter(Mandatory = $true)][string]$TaskName
)

$ErrorActionPreference = 'Stop'

function Write-JsonAtomic([string]$Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$Path.tmp-$PID-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
  $Payload | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $tmp -Encoding UTF8
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

function Remove-OwnScheduledTaskNow([string]$Name, [string]$ManifestPath, [string]$StatusPath) {
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
    $status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $StatusPath -Encoding UTF8
  } catch {}
  if ($deleted) { Remove-Item -Force -LiteralPath $ManifestPath -ErrorAction SilentlyContinue }
  return $deleted
}

function Start-DeferredTaskCleanup([string]$Name, [string]$ManifestPath, [string]$StatusPath) {
  $escapedName = $Name.Replace("'", "''")
  $escapedManifest = $ManifestPath.Replace("'", "''")
  $escapedStatus = $StatusPath.Replace("'", "''")
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
  `$status | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath '$escapedStatus' -Encoding UTF8
} catch {}
if (`$deleted) { Remove-Item -Force -LiteralPath '$escapedManifest' -ErrorAction SilentlyContinue }
"@
  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-Command',$command) -WindowStyle Hidden | Out-Null
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
$lockName = 'Local\FBGroupMonitor_' + (($TaskName -replace '[^A-Za-z0-9_]', '_'))
$mutex = New-Object System.Threading.Mutex($false, $lockName)
$lockAcquired = $false
$guardProcess = $null
$exitCode = 1
$normalRunnerExit = $false

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
    started_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
  })

  # Start the power guard before opening Chrome or waiting for CDP. The whole scheduled
  # execution, including browser startup, is protected against sleep and cancellable shutdowns.
  if ([bool]$m.enable_power_guard) {
    $guardScript = Join-Path $RootDir 'scripts\runtime_power_guard.ps1'
    if (Test-Path -LiteralPath $guardScript) {
      $guardProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
        '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$guardScript,
        '-RunDir',$RunDir,'-ParentPid',[string]$PID,'-PollSeconds',[string]$m.power_guard_poll_seconds
      ) -PassThru -WindowStyle Hidden
    }
  }

  if (-not (Test-Cdp ([string]$m.cdp))) {
    $openChrome = Join-Path $RootDir 'scripts\open_chrome_9222.ps1'
    if (Test-Path -LiteralPath $openChrome) {
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $openChrome -Cdp ([string]$m.cdp) 1>> $StdoutLog 2>> $StderrLog
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
  if ([bool]$m.shutdown_after_complete) {
    $nodeArgs.Add('--shutdown-after-complete') | Out-Null; $nodeArgs.Add('true') | Out-Null
    $nodeArgs.Add('--shutdown-delay-seconds') | Out-Null; $nodeArgs.Add([string]$m.shutdown_delay_seconds) | Out-Null
  }
  if (-not [string]::IsNullOrWhiteSpace([string]$m.config)) {
    $nodeArgs.Add('--config') | Out-Null; $nodeArgs.Add([string]$m.config) | Out-Null
  }

  Write-JsonAtomic $RunnerStatus ([ordered]@{
    status = 'phase2_running'
    task_name = $TaskName
    runner_pid = $PID
    power_guard_pid = if ($guardProcess) { $guardProcess.Id } else { $null }
    run_dir = $RunDir
    started_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
  })

  & node @nodeArgs 1>> $StdoutLog 2>> $StderrLog
  $exitCode = $LASTEXITCODE
  $normalRunnerExit = $true
  Add-Content -LiteralPath $StdoutLog -Value "[scheduled] finished_at=$((Get-Date).ToString('o')) exit_code=$exitCode"

  Write-JsonAtomic $RunnerStatus ([ordered]@{
    status = if ($exitCode -eq 0) { 'finished_success' } else { 'finished_error' }
    task_name = $TaskName
    runner_pid = $PID
    exit_code = $exitCode
    run_dir = $RunDir
    finished_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
  })
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
    finished_at = (Get-Date).ToString('o')
    scheduled_task_deleted = $false
  })
}
finally {
  if ($guardProcess -and -not $guardProcess.HasExited) {
    $guardStopFile = Join-Path $RunDir 'runtime_power_guard.stop'
    try { Set-Content -LiteralPath $guardStopFile -Value ((Get-Date).ToString('o')) -Encoding UTF8 } catch {}
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
    $deletedNow = Remove-OwnScheduledTaskNow -Name $TaskName -ManifestPath $Manifest -StatusPath $RunnerStatus
    if (-not $deletedNow) {
      Start-DeferredTaskCleanup -Name $TaskName -ManifestPath $Manifest -StatusPath $RunnerStatus
    }
  }
}

exit $exitCode
