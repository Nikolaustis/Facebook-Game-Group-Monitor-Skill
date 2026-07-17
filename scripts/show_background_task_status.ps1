param(
  [string]$RunDir = "",
  [int]$Tail = 80
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  $runsRoot = Join-Path $PSScriptRoot "..\runs"
  if (-not (Test-Path $runsRoot)) { throw "未找到 runs 目录，请传入 -RunDir。" }
  $latest = Get-ChildItem -LiteralPath $runsRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $latest) { throw "runs 目录为空，请传入 -RunDir。" }
  $RunDir = $latest.FullName
}

$RunDir = (Resolve-Path $RunDir).Path
$statusFile = Join-Path $RunDir "background_task.json"
if (-not (Test-Path $statusFile)) { throw "未找到 background_task.json：$statusFile" }
$status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
$running = $false
$scheduledTaskState = $null
$runnerProcessAlive = $false
if ($status.pid) {
  $running = $null -ne (Get-Process -Id ([int]$status.pid) -ErrorAction SilentlyContinue)
}
$runnerStatusPath = Join-Path $RunDir 'scheduled_phase2_runner_status.json'
if (Test-Path -LiteralPath $runnerStatusPath) {
  try {
    $runnerSnapshot = Get-Content -Raw -LiteralPath $runnerStatusPath | ConvertFrom-Json
    if ($runnerSnapshot.runner_pid) {
      $runnerProcessAlive = $null -ne (Get-Process -Id ([int]$runnerSnapshot.runner_pid) -ErrorAction SilentlyContinue)
      if ($runnerProcessAlive) { $running = $true }
    }
  } catch {}
}
if ($status.scheduled_task_name) {
  $scheduledTask = Get-ScheduledTask -TaskName ([string]$status.scheduled_task_name) -ErrorAction SilentlyContinue
  if ($scheduledTask) {
    $scheduledTaskState = [string]$scheduledTask.State
    if ($scheduledTask.State -eq 'Running') { $running = $true }
  } else {
    $scheduledTaskState = 'DeletedOrMissing'
  }
}

$result = [ordered]@{
  task = $status.task
  launch_mode = $status.launch_mode
  pid = $status.pid
  running = $running
  scheduled_task_name = $status.scheduled_task_name
  scheduled_task_state = $scheduledTaskState
  scheduled_task_self_delete = $status.scheduled_task_self_delete
  effective_launcher = $status.effective_launcher
  startup_verified = $status.startup_verified
  runner_process_alive = $runnerProcessAlive
  started_at = $status.started_at
  run_dir = $RunDir
  final_xlsx_exists = Test-Path (Join-Path $RunDir "fb_monitoring_filtered.xlsx")
  progress = $null
  phase2_progress = $null
  login_state = $null
  completion = $null
  shutdown_after_complete = $status.shutdown_after_complete
  shutdown_delay_seconds = $status.shutdown_delay_seconds
  shutdown_force_apps = $status.shutdown_force_apps
  shutdown_watcher = $null
  scheduled_runner = $null
  runtime_power_guard = $null
  scheduled_bootstrap = $null
  scheduler_startup_diagnostic = $null
  launcher_trace_tail = $null
  stdout_log = $status.stdout_log
  stderr_log = $status.stderr_log
}

$progressFile = Join-Path $RunDir "codex_progress_report.json"
if (Test-Path $progressFile) {
  $result.progress = Get-Content -LiteralPath $progressFile -Raw | ConvertFrom-Json
}
$phase2ProgressFile = Join-Path $RunDir "phase2_progress.json"
if (Test-Path $phase2ProgressFile) {
  $result.phase2_progress = Get-Content -LiteralPath $phase2ProgressFile -Raw | ConvertFrom-Json
}
$loginStateFile = Join-Path $RunDir "login_state.json"
if (Test-Path $loginStateFile) {
  $result.login_state = Get-Content -LiteralPath $loginStateFile -Raw | ConvertFrom-Json
}
$completionFile = Join-Path $RunDir "codex_task_complete.json"
if (Test-Path $completionFile) {
  $result.completion = Get-Content -LiteralPath $completionFile -Raw | ConvertFrom-Json
}
$shutdownWatcherFile = Join-Path $RunDir "conditional_shutdown_watcher_status.json"
if (Test-Path $shutdownWatcherFile) {
  $result.shutdown_watcher = Get-Content -LiteralPath $shutdownWatcherFile -Raw | ConvertFrom-Json
}

$scheduledRunnerFile = Join-Path $RunDir "scheduled_phase2_runner_status.json"
if (Test-Path $scheduledRunnerFile) {
  $result.scheduled_runner = Get-Content -LiteralPath $scheduledRunnerFile -Raw | ConvertFrom-Json
}

$bootstrapStatusFile = Join-Path $RunDir 'scheduled_phase2_bootstrap_status.json'
if (Test-Path -LiteralPath $bootstrapStatusFile) {
  try { $result.scheduled_bootstrap = Get-Content -LiteralPath $bootstrapStatusFile -Raw | ConvertFrom-Json } catch {}
}
$schedulerDiagnosticFile = Join-Path $RunDir 'scheduled_phase2_startup_diagnostic.json'
if (Test-Path -LiteralPath $schedulerDiagnosticFile) {
  try { $result.scheduler_startup_diagnostic = Get-Content -LiteralPath $schedulerDiagnosticFile -Raw | ConvertFrom-Json } catch {}
}
$launcherTraceFile = Join-Path $RunDir 'scheduled_phase2_launcher_trace.log'
if (Test-Path -LiteralPath $launcherTraceFile) {
  try { $result.launcher_trace_tail = @(Get-Content -LiteralPath $launcherTraceFile -Tail 30) } catch {}
}

$powerGuardFile = Join-Path $RunDir "runtime_power_guard_status.json"
if (Test-Path $powerGuardFile) {
  $result.runtime_power_guard = Get-Content -LiteralPath $powerGuardFile -Raw | ConvertFrom-Json
}

$result | ConvertTo-Json -Depth 12

if ($Tail -gt 0 -and $status.stdout_log -and (Test-Path $status.stdout_log)) {
  Write-Host "`n--- stdout tail: $($status.stdout_log) ---"
  Get-Content -LiteralPath $status.stdout_log -Tail $Tail
}
if ($Tail -gt 0 -and $status.stderr_log -and (Test-Path $status.stderr_log)) {
  Write-Host "`n--- stderr tail: $($status.stderr_log) ---"
  Get-Content -LiteralPath $status.stderr_log -Tail $Tail
}
