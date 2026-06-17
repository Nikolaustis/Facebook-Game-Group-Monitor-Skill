param(
  [string]$RunDir = "runs\onepiece_pet_pokemon_20260611_182818",
  [string]$Cdp = "http://127.0.0.1:9222"
)

$ErrorActionPreference = "Stop"

$RunDir = (Resolve-Path $RunDir).Path
$statusPath = Join-Path $RunDir "phase2_shutdown_status.json"
$stdoutPath = Join-Path $RunDir "phase2_resume_stdout.log"
$stderrPath = Join-Path $RunDir "phase2_resume_stderr.log"

function Write-JsonNoBom($Path, $Object) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, ($Object | ConvertTo-Json -Depth 20), $utf8NoBom)
}

function Write-RunnerStatus($Message) {
  Add-Content -Path (Join-Path $RunDir "runner_status.log") -Value ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss K"), $Message) -Encoding UTF8
}

Write-JsonNoBom $statusPath ([ordered]@{
  status = "phase2_running"
  run_dir = $RunDir
  resumed_at = (Get-Date).ToString("o")
  checkpoint = (Join-Path $RunDir "phase2_autosave_state.json")
  note = "Resume requested by user; phase2_collect_details.js launched with --resume true."
})
Write-RunnerStatus "Phase2 resume started from autosave"

& node scripts\phase2_collect_details.js `
  --index (Join-Path $RunDir "phase1_index.json") `
  --threshold 10 `
  --snapshot-date 2026-06-11 `
  --config (Join-Path $RunDir "task_config.json") `
  --out-xlsx (Join-Path $RunDir "fb_monitoring_filtered.xlsx") `
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

if (Test-Path (Join-Path $RunDir "fb_monitoring_filtered.xlsx")) {
  Write-RunnerStatus "Phase2 resume completed; final xlsx generated"
} else {
  Write-RunnerStatus "Phase2 resume exited before final xlsx was generated"
}
