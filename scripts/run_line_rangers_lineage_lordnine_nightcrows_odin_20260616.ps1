param(
  [string]$RunDir = "",
  [string]$Cdp = "http://127.0.0.1:9333",
  [string]$Deadline = "2026-06-17T09:00:00+08:00"
)

$ErrorActionPreference = "Stop"

function Write-JsonNoBom($Path, $Text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $utf8NoBom)
}

function Write-Status($Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')] $Message"
  Write-Host $line
  Add-Content -Path (Join-Path $RunDir "runner_status.log") -Value $line -Encoding UTF8
}

function Write-ObjectJsonNoBom($Path, $Object) {
  Write-JsonNoBom $Path ($Object | ConvertTo-Json -Depth 30)
}

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  $RunDir = Join-Path (Get-Location) ("runs\line_rangers_lineage_lordnine_nightcrows_odin_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
}
$RunDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $RunDir)).Path

$gamesPath = Join-Path $RunDir "games.json"
$configPath = Join-Path $RunDir "task_config.json"
$indexPath = Join-Path $RunDir "phase1_index.json"
$statusPath = Join-Path $RunDir "phase2_shutdown_status.json"
$phase1ReportJson = Join-Path $RunDir "phase1_report.json"
$phase1ReportMd = Join-Path $RunDir "phase1_report.md"
$finalXlsx = Join-Path $RunDir "fb_monitoring_filtered.xlsx"
$snapshotDate = (Get-Date).ToString("yyyy-MM-dd")

$gamesJson = @'
[
  "LINE Idle Rangers",
  "LINE Rangers",
  "Lineage2M",
  "LORDNINE: Infinite Class",
  "Night Crows",
  "ODIN: Valhalla Rising"
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
    "LINE Idle Rangers": ["LINE Rangers\u653e\u7f6e\u6230\u722d"],
    "LINE Rangers": ["LINE Rangers\u9280\u6cb3\u7279\u653b\u968a", "LINE \u30ec\u30f3\u30b8\u30e3\u30fc"],
    "Lineage2M": ["Lineage 2M", "\u5929\u58022M", "\ub9ac\ub2c8\uc9c02M", "\u30ea\u30cd\u30fc\u30b8\u30e52M"],
    "LORDNINE: Infinite Class": ["LORDNINE", "\ub85c\ub4dc\ub098\uc778", "\u6b0a\u529b\u4e4b\u671b"],
    "Night Crows": ["\u591c\u9d09", "\ub098\uc774\ud2b8 \ud06c\ub85c\uc6b0"],
    "ODIN: Valhalla Rising": ["\u5967\u4e01\uff1a\u795e\u53db", "\uc624\ub518 \ubc1c\ud560\ub77c \ub77c\uc774\uc9d5"]
  },
  "ip_roots": {
    "LINE Idle Rangers": ["LINE Idle Rangers", "LINE Rangers\u653e\u7f6e\u6230\u722d"],
    "LINE Rangers": ["LINE Rangers", "LINE Rangers\u9280\u6cb3\u7279\u653b\u968a", "LINE \u30ec\u30f3\u30b8\u30e3\u30fc"],
    "Lineage2M": ["Lineage2M", "Lineage 2M", "\u5929\u58022M", "\ub9ac\ub2c8\uc9c02M", "\u30ea\u30cd\u30fc\u30b8\u30e52M"],
    "LORDNINE: Infinite Class": ["LORDNINE", "LORDNINE: Infinite Class", "\ub85c\ub4dc\ub098\uc778", "\u6b0a\u529b\u4e4b\u671b"],
    "Night Crows": ["Night Crows", "\u591c\u9d09", "\ub098\uc774\ud2b8 \ud06c\ub85c\uc6b0"],
    "ODIN: Valhalla Rising": ["ODIN", "ODIN: Valhalla Rising", "\u5967\u4e01\uff1a\u795e\u53db", "\uc624\ub518 \ubc1c\ud560\ub77c \ub77c\uc774\uc9d5"]
  },
  "sibling_titles": {
    "LINE Idle Rangers": ["LINE Rangers"],
    "LINE Rangers": ["LINE Idle Rangers"],
    "Lineage2M": ["Lineage", "Lineage W", "Lineage M"],
    "LORDNINE: Infinite Class": ["Lord of Nine"],
    "Night Crows": [],
    "ODIN: Valhalla Rising": ["ODIN: Valhalla Rising Global"]
  },
  "title_variant_overrides": {
    "LINE Idle Rangers": {
      "search_variants": [
        { "query": "LINE Rangers\u653e\u7f6e\u6230\u722d", "type": "configured_variant" }
      ]
    },
    "LINE Rangers": {
      "search_variants": [
        { "query": "LINE Rangers\u9280\u6cb3\u7279\u653b\u968a", "type": "configured_variant" },
        { "query": "LINE \u30ec\u30f3\u30b8\u30e3\u30fc", "type": "configured_variant" }
      ]
    },
    "Lineage2M": {
      "search_variants": [
        { "query": "Lineage 2M", "type": "configured_variant" },
        { "query": "\u5929\u58022M", "type": "configured_variant" },
        { "query": "\ub9ac\ub2c8\uc9c02M", "type": "configured_variant" },
        { "query": "\u30ea\u30cd\u30fc\u30b8\u30e52M", "type": "configured_variant" }
      ]
    },
    "LORDNINE: Infinite Class": {
      "search_variants": [
        { "query": "LORDNINE", "type": "configured_variant" },
        { "query": "\ub85c\ub4dc\ub098\uc778", "type": "configured_variant" },
        { "query": "\u6b0a\u529b\u4e4b\u671b", "type": "configured_variant" }
      ]
    },
    "Night Crows": {
      "search_variants": [
        { "query": "\u591c\u9d09", "type": "configured_variant" },
        { "query": "\ub098\uc774\ud2b8 \ud06c\ub85c\uc6b0", "type": "configured_variant" }
      ]
    },
    "ODIN: Valhalla Rising": {
      "search_variants": [
        { "query": "\u5967\u4e01\uff1a\u795e\u53db", "type": "configured_variant" },
        { "query": "\uc624\ub518 \ubc1c\ud560\ub77c \ub77c\uc774\uc9d5", "type": "configured_variant" }
      ]
    }
  }
}
"@

Write-JsonNoBom $gamesPath $gamesJson
Write-JsonNoBom $configPath $configJson
Write-ObjectJsonNoBom $statusPath ([ordered]@{
  status = "starting"
  run_dir = $RunDir
  deadline = $Deadline
  cdp = $Cdp
  updated_at = (Get-Date).ToString("o")
})

Write-Status "Run directory: $RunDir"
Write-Status "Phase1 started"
& node scripts\phase1_collect_candidates.js `
  --games-file $gamesPath `
  --out-dir $RunDir `
  --config $configPath `
  --cdp $Cdp `
  --out-codex-progress (Join-Path $RunDir "codex_progress_report.json") `
  1> (Join-Path $RunDir "phase1_stdout.log") 2> (Join-Path $RunDir "phase1_stderr.log")

if (-not (Test-Path $indexPath)) {
  throw "phase1_index.json not generated"
}

$index = Get-Content -Raw $indexPath | ConvertFrom-Json
$totalCandidates = 0
$lines = @("# Phase1 report", "", "Run dir: $RunDir", "", "| Game | Candidates | Stop reason |", "|---|---:|---|")
$gamesReport = @()
foreach ($game in $index.games) {
  $count = [int]$game.candidates_count
  $totalCandidates += $count
  $lines += ("| {0} | {1} | {2} |" -f $game.game_name, $count, $game.stop_reason)
  $gamesReport += [ordered]@{
    game_name = $game.game_name
    candidates_count = $count
    stop_reason = $game.stop_reason
    candidates_file = $game.candidates_file
    stats_file = $game.stats_file
  }
}
$estimatedHours = [Math]::Round(($totalCandidates * 0.95) / 60, 1)
Write-ObjectJsonNoBom $phase1ReportJson ([ordered]@{
  status = "phase1_completed_phase2_started"
  run_dir = $RunDir
  total_candidates = $totalCandidates
  estimated_phase2_hours = $estimatedHours
  note = "Estimate uses about 0.95 minute per candidate and will vary with Facebook loading and about-page retries."
  games = $gamesReport
  completed_at = (Get-Date).ToString("o")
})
$lines += ""
$lines += ("Total candidates: {0}" -f $totalCandidates)
$lines += ("Rough phase2 estimate: {0} hours" -f $estimatedHours)
Set-Content -Path $phase1ReportMd -Value $lines -Encoding UTF8

Write-Status ("Phase1 completed; total_candidates={0}; estimated_phase2_hours={1}; Phase2 will start without confirmation" -f $totalCandidates, $estimatedHours)
Write-ObjectJsonNoBom $statusPath ([ordered]@{
  status = "phase2_running_with_conditional_shutdown"
  run_dir = $RunDir
  phase1_index = $indexPath
  phase1_report = $phase1ReportJson
  deadline = $Deadline
  cdp = $Cdp
  updated_at = (Get-Date).ToString("o")
})

Write-Status "Phase2 started"
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
  --checkpoint-every 1 `
  --checkpoint-every-candidate 1 `
  --cdp $Cdp `
  1> (Join-Path $RunDir "phase2_stdout.log") 2> (Join-Path $RunDir "phase2_stderr.log")

$now = Get-Date
if (Test-Path $finalXlsx) {
  Write-Status "Phase2 completed; final xlsx exists. Closing Chrome."
  Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  $deadlineAt = [DateTimeOffset]::Parse($Deadline).LocalDateTime
  if ($now -lt $deadlineAt) {
    Write-ObjectJsonNoBom $statusPath ([ordered]@{
      status = "completed_shutdown_scheduled"
      run_dir = $RunDir
      final_xlsx = $finalXlsx
      chrome_close_attempted = $true
      shutdown_requested = $true
      deadline = $Deadline
      completed_at = $now.ToString("o")
    })
    Write-Status "Completed before deadline; shutting down computer now"
    Stop-Computer -Force
  } else {
    Write-ObjectJsonNoBom $statusPath ([ordered]@{
      status = "completed_after_deadline"
      run_dir = $RunDir
      final_xlsx = $finalXlsx
      chrome_close_attempted = $true
      shutdown_requested = $false
      deadline = $Deadline
      completed_at = $now.ToString("o")
    })
    Write-Status "Completed after shutdown deadline; leaving computer on"
  }
} else {
  Write-ObjectJsonNoBom $statusPath ([ordered]@{
    status = "phase2_exited_without_final_xlsx"
    run_dir = $RunDir
    final_xlsx = $finalXlsx
    shutdown_requested = $false
    deadline = $Deadline
    completed_at = $now.ToString("o")
  })
  Write-Status "Phase2 exited before final xlsx was generated; no shutdown"
}

