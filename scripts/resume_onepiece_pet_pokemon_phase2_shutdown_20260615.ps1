param(
  [string]$RunDir = "runs\onepiece_pet_pokemon_20260611_182818",
  [string]$Cdp = "http://127.0.0.1:9222",
  [string]$Deadline = "2026-06-16T09:00:00+08:00"
)

$ErrorActionPreference = "Stop"

$RunDir = (Resolve-Path $RunDir).Path
$statusPath = Join-Path $RunDir "phase2_shutdown_status.json"
$stdoutPath = Join-Path $RunDir "phase2_resume_shutdown_stdout.log"
$stderrPath = Join-Path $RunDir "phase2_resume_shutdown_stderr.log"
$finalXlsx = Join-Path $RunDir "fb_monitoring_filtered.xlsx"

function Write-JsonNoBom($Path, $Object) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 20), $utf8NoBom)
}

function Write-RunnerStatus($Message) {
  Add-Content -Path (Join-Path $RunDir "runner_status.log") -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss K"), $Message) -Encoding UTF8
}

Write-JsonNoBom $statusPath ([ordered]@{
  status = "phase2_running_with_conditional_shutdown"
  run_dir = $RunDir
  resumed_at = (Get-Date).ToString("o")
  checkpoint = (Join-Path $RunDir "phase2_autosave_state.json")
  deadline = $Deadline
  note = "Resume requested by user; close Chrome after final xlsx, then shut down if before deadline."
})
Write-RunnerStatus "Phase2 resume with conditional shutdown started from autosave; deadline=$Deadline"

& node scripts\phase2_collect_details.js `
  --index (Join-Path $RunDir "phase1_index.json") `
  --threshold 10 `
  --snapshot-date 2026-06-11 `
  --config (Join-Path $RunDir "task_config.json") `
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
  --checkpoint-every 1 `
  --checkpoint-every-candidate 1 `
  --resume true `
  --cdp $Cdp `
  1> $stdoutPath 2> $stderrPath

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
  Write-RunnerStatus "Phase2 resume exited before final xlsx was generated; no shutdown"
}
