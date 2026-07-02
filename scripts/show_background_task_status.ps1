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
if ($status.pid) {
  $running = $null -ne (Get-Process -Id ([int]$status.pid) -ErrorAction SilentlyContinue)
}

$result = [ordered]@{
  task = $status.task
  pid = $status.pid
  running = $running
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

$result | ConvertTo-Json -Depth 12

if ($Tail -gt 0 -and $status.stdout_log -and (Test-Path $status.stdout_log)) {
  Write-Host "`n--- stdout tail: $($status.stdout_log) ---"
  Get-Content -LiteralPath $status.stdout_log -Tail $Tail
}
if ($Tail -gt 0 -and $status.stderr_log -and (Test-Path $status.stderr_log)) {
  Write-Host "`n--- stderr tail: $($status.stderr_log) ---"
  Get-Content -LiteralPath $status.stderr_log -Tail $Tail
}
