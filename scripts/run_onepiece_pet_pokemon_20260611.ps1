param(
  [string]$RunDir = "",
  [string]$Cdp = "http://127.0.0.1:9222",
  [string]$Deadline = "2026-06-12T13:30:00+08:00"
)

$ErrorActionPreference = "Stop"

function Write-Status($Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')] $Message"
  Write-Host $line
  Add-Content -Path (Join-Path $RunDir "runner_status.log") -Value $line -Encoding UTF8
}

function Write-JsonNoBom($Path, $Text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  $RunDir = Join-Path (Get-Location) ("runs\onepiece_pet_pokemon_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
}
$RunDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $RunDir)).Path

$configPath = Join-Path $RunDir "task_config.json"
$gamesPath = Join-Path $RunDir "games.json"
$indexPath = Join-Path $RunDir "phase1_index.json"
$completionPath = Join-Path $RunDir "phase2_shutdown_status.json"
$phase1Log = Join-Path $RunDir "phase1_stdout.log"
$phase1Err = Join-Path $RunDir "phase1_stderr.log"
$phase2Log = Join-Path $RunDir "phase2_stdout.log"
$phase2Err = Join-Path $RunDir "phase2_stderr.log"

$snapshotDate = (Get-Date).ToString("yyyy-MM-dd")

$gamesJson = @'
[
  "One piece bounty rush",
  "One Piece Fighting Path",
  "Pet Simulator 99",
  "Pok\u00e9mon Go"
]
'@

$configJson = @"
{
  "snapshot_date": "$snapshotDate",
  "threshold": 10,
  "checkpoint_every": 1,
  "checkpoint_every_candidate": 1,
  "close_chrome_after_report": true,
  "shutdown_after_complete": false,
  "aliases": {
    "One piece bounty rush": ["One Piece Bounty Rush", "OPBR"],
    "One Piece Fighting Path": ["One Piece: Fighting Path"],
    "Pet Simulator 99": ["Pet Sim 99", "PS99"],
    "Pok\u00e9mon Go": ["Pokemon Go", "Pokemon GO", "Pok\u00e9mon GO"]
  },
  "ip_roots": {
    "One piece bounty rush": ["One Piece", "Bounty Rush"],
    "One Piece Fighting Path": ["One Piece", "Fighting Path"],
    "Pet Simulator 99": ["Pet Simulator 99", "Pet Sim 99"],
    "Pok\u00e9mon Go": ["Pokemon Go", "Pok\u00e9mon Go"]
  },
  "title_variant_overrides": {
    "One piece bounty rush": {
      "search_variants": [
        { "query": "One Piece Bounty Rush", "type": "configured_variant" },
        { "query": "OPBR", "type": "configured_variant", "min_group_size": 1000, "min_today_posts": 20, "min_week_new_fans": 50 }
      ]
    },
    "One Piece Fighting Path": {
      "search_variants": [
        { "query": "One Piece: Fighting Path", "type": "configured_variant" }
      ]
    },
    "Pet Simulator 99": {
      "search_variants": [
        { "query": "Pet Sim 99", "type": "configured_variant" },
        { "query": "PS99", "type": "configured_variant", "min_group_size": 1000, "min_today_posts": 20, "min_week_new_fans": 50 }
      ]
    },
    "Pok\u00e9mon Go": {
      "search_variants": [
        { "query": "Pokemon Go", "type": "configured_variant" },
        { "query": "Pokemon GO", "type": "configured_variant" },
        { "query": "Pok\u00e9mon GO", "type": "configured_variant" }
      ]
    }
  }
}
"@

Write-JsonNoBom $gamesPath $gamesJson
Write-JsonNoBom $configPath $configJson

Write-JsonNoBom $completionPath (@{
  status = "starting"
  run_dir = $RunDir
  deadline = $Deadline
  updated_at = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 6)

Write-Status "Run directory: $RunDir"
Write-Status "Phase1 started"
& node scripts\phase1_collect_candidates.js `
  --games-file $gamesPath `
  --out-dir $RunDir `
  --config $configPath `
  --cdp $Cdp `
  --out-codex-progress (Join-Path $RunDir "codex_progress_report.json") `
  1> $phase1Log 2> $phase1Err

if (-not (Test-Path $indexPath)) {
  throw "phase1_index.json not generated"
}
Write-Status "Phase1 completed; Phase2 will start without confirmation"

Write-JsonNoBom $completionPath (@{
  status = "phase2_running"
  run_dir = $RunDir
  phase1_index = $indexPath
  deadline = $Deadline
  updated_at = (Get-Date).ToString("o")
} | ConvertTo-Json -Depth 6)

Write-Status "Phase2 started"
& node scripts\phase2_collect_details.js `
  --index $indexPath `
  --threshold 10 `
  --snapshot-date $snapshotDate `
  --config $configPath `
  --out-xlsx (Join-Path $RunDir "fb_monitoring_filtered.xlsx") `
  --out-summary (Join-Path $RunDir "fb_monitoring_filtered_summary.json") `
  --out-collision (Join-Path $RunDir "collision_report.json") `
  --out-audit (Join-Path $RunDir "audit_stats.json") `
  --out-debug-rows (Join-Path $RunDir "debug_rows.json") `
  --out-partial-xlsx (Join-Path $RunDir "partial_verified_rows.xlsx") `
  --out-checkpoint (Join-Path $RunDir "phase2_autosave_state.json") `
  --out-partial-summary (Join-Path $RunDir "phase2_autosave_summary.json") `
  --out-progress (Join-Path $RunDir "phase2_progress.json") `
  --out-completion $completionPath `
  --checkpoint-every 1 `
  --checkpoint-every-candidate 1 `
  --cdp $Cdp `
  1> $phase2Log 2> $phase2Err

$finalXlsx = Join-Path $RunDir "fb_monitoring_filtered.xlsx"
if (-not (Test-Path $finalXlsx)) {
  throw "Final xlsx was not generated"
}

Write-Status "Phase2 completed and final xlsx exists"
Write-Status "Ensuring Chrome is closed"
Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

$now = Get-Date
$deadlineAt = [DateTimeOffset]::Parse($Deadline).LocalDateTime
if ($now -lt $deadlineAt) {
  Write-JsonNoBom $completionPath (@{
    status = "completed_shutdown_scheduled"
    run_dir = $RunDir
    final_xlsx = $finalXlsx
    chrome_close_attempted = $true
    shutdown_requested = $true
    deadline = $Deadline
    completed_at = $now.ToString("o")
  } | ConvertTo-Json -Depth 6)
  Write-Status "Completed before deadline; shutting down computer now"
  Stop-Computer -Force
} else {
  Write-JsonNoBom $completionPath (@{
    status = "completed_after_deadline"
    run_dir = $RunDir
    final_xlsx = $finalXlsx
    chrome_close_attempted = $true
    shutdown_requested = $false
    deadline = $Deadline
    completed_at = $now.ToString("o")
  } | ConvertTo-Json -Depth 6)
  Write-Status "Completed after shutdown deadline; leaving computer on"
}
