param(
  [string]$RunDir = "runs\line_rangers_lineage_lordnine_nightcrows_odin_20260616_165113",
  [string]$Cdp = "http://127.0.0.1:9333",
  [string]$Deadline = "2026-06-17T09:00:00+08:00"
)

$ErrorActionPreference = "Stop"

$RunDir = (Resolve-Path $RunDir).Path
$indexPath = Join-Path $RunDir "phase1_index.json"
$configPath = Join-Path $RunDir "task_config.json"
$statusPath = Join-Path $RunDir "phase2_shutdown_status.json"
$finalXlsx = Join-Path $RunDir "fb_monitoring_filtered.xlsx"
$snapshotDate = (Get-Date).ToString("yyyy-MM-dd")

function Write-JsonNoBom($Path, $Object) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 20), $utf8NoBom)
}

function Write-RunnerStatus($Message) {
  Add-Content -Path (Join-Path $RunDir "runner_status.log") -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss K"), $Message) -Encoding UTF8
}

if (-not (Test-Path $indexPath)) {
  throw "phase1_index.json not found: $indexPath"
}
if (-not (Test-Path $configPath)) {
  throw "task_config.json not found: $configPath"
}

Write-JsonNoBom $statusPath ([ordered]@{
  status = "phase2_running_with_conditional_shutdown"
  run_dir = $RunDir
  phase1_index = $indexPath
  deadline = $Deadline
  cdp = $Cdp
  started_at = (Get-Date).ToString("o")
  note = "Phase2 started from completed phase1 index. Close Chrome after final xlsx, then shut down if before deadline."
})
Write-RunnerStatus "Phase2-only run started; deadline=$Deadline"

& node scripts\phase2_collect_details.js `
  --index $indexPath `
  --threshold 10 `
  --snapshot-date $snapshotDate `
  --config $configPath `
  --out-xlsx $finalXlsx `
  --out-summary (Join-Path $RunDir "fb_monitoring_filtered_summary.json") `
  --out-collision (Join-Path $RunDir "collision_report.json") `
  --out-audit (Join-Path $RunDir "audit_stats.json") `
  --out-debug-rows (Join-Path $RunDir "debug_rows.json") `
  --out-partial-xlsx (Join-Path $RunDir "partial_verified_rows.xlsx") `
  --out-checkpoint (Join-Path $RunDir "phase2_autosave_state.json") `
  --out-partial-summary (Join-Path $RunDir "phase2_autosave_summary.json") `
  --out-progress (Join-Path $RunDir "phase2_progress.json") `
  --out-completion $statusPath `
  --out-codex-progress (Join-Path $RunDir "codex_progress_report.json") `
  --checkpoint-every 1 `
  --checkpoint-every-candidate 1 `
  --cdp $Cdp `
  1> (Join-Path $RunDir "phase2_only_stdout.log") 2> (Join-Path $RunDir "phase2_only_stderr.log")

$now = Get-Date
if (Test-Path $finalXlsx) {
  Write-RunnerStatus "Phase2 completed; final xlsx exists. Closing Chrome."
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  $deadlineAt = [DateTimeOffset]::Parse($Deadline).LocalDateTime
  if ($now -lt $deadlineAt) {
    Write-JsonNoBom $statusPath ([ordered]@{
      status = "completed_shutdown_scheduled"
      run_dir = $RunDir
      final_xlsx = $finalXlsx
      chrome_close_attempted = $true
      shutdown_requested = $true
      deadline = $Deadline
      completed_at = $now.ToString("o")
    })
    Write-RunnerStatus "Completed before deadline; shutting down computer now"
    Stop-Computer -Force
  } else {
    Write-JsonNoBom $statusPath ([ordered]@{
      status = "completed_after_deadline"
      run_dir = $RunDir
      final_xlsx = $finalXlsx
      chrome_close_attempted = $true
      shutdown_requested = $false
      deadline = $Deadline
      completed_at = $now.ToString("o")
    })
    Write-RunnerStatus "Completed after shutdown deadline; leaving computer on"
  }
} else {
  Write-JsonNoBom $statusPath ([ordered]@{
    status = "phase2_exited_without_final_xlsx"
    run_dir = $RunDir
    final_xlsx = $finalXlsx
    shutdown_requested = $false
    deadline = $Deadline
    completed_at = $now.ToString("o")
  })
  Write-RunnerStatus "Phase2 exited before final xlsx was generated; no shutdown"
}
