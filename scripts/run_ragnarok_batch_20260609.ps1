param(
  [string]$RunDir = "",
  [string]$Cdp = "http://127.0.0.1:9222",
  [string]$UserDataDir = "C:\temp\chrome-cdp"
)

$ErrorActionPreference = "Stop"

function Write-Status($Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')] $Message"
  Write-Host $line
  Add-Content -Path (Join-Path $RunDir "runner_status.log") -Value $line -Encoding UTF8
}

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  $RunDir = Join-Path (Get-Location) ("runs\ragnarok_batch_strict_" + (Get-Date -Format "yyyyMMdd_HHmmss"))
}
$RunDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $RunDir)).Path

$configPath = Join-Path $RunDir "task_config.json"
$phase1Log = Join-Path $RunDir "phase1_stdout.log"
$phase1Err = Join-Path $RunDir "phase1_stderr.log"
$phase2Log = Join-Path $RunDir "phase2_stdout.log"
$phase2Err = Join-Path $RunDir "phase2_stderr.log"
$cleanLog = Join-Path $RunDir "clean_stdout.log"
$cleanErr = Join-Path $RunDir "clean_stderr.log"

$config = @'
{
  "snapshot_date": "2026-06-09",
  "threshold": 10,
  "checkpoint_every": 1,
  "checkpoint_every_candidate": 1,
  "aliases": {
    "Ragnarok: The New World": ["RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u4E16\u754C\u4E4B\u65C5"],
    "Ragnarok M Eternal Love": ["RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u5B88\u8B77\u6C38\u6046\u7684\u611B"],
    "Ragnarok M: Classic": ["RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u5B88\u8B77\u6C38\u6046\u7684\u611B Classic"],
    "Ragnarok Origin Classic": ["RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u611B\u5982\u521D\u898B Classic"],
    "Ragnarok X: Next Generation": ["Ragnarok X", "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u65B0\u4E16\u4EE3\u7684\u8A95\u751F"],
    "Ragnarok: Midgard Senki": []
  },
  "ip_roots": {
    "Ragnarok: The New World": ["Ragnarok", "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u4E16\u754C\u4E4B\u65C5"],
    "Ragnarok M Eternal Love": ["Ragnarok", "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u5B88\u8B77\u6C38\u6046\u7684\u611B"],
    "Ragnarok M: Classic": ["Ragnarok", "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u5B88\u8B77\u6C38\u6046\u7684\u611B Classic"],
    "Ragnarok Origin Classic": ["Ragnarok", "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u611B\u5982\u521D\u898B Classic"],
    "Ragnarok X: Next Generation": ["Ragnarok X", "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u65B0\u4E16\u4EE3\u7684\u8A95\u751F"],
    "Ragnarok: Midgard Senki": ["Ragnarok", "Midgard Senki"]
  },
  "title_variant_overrides": {
    "Ragnarok: The New World": {
      "search_variants": [{ "query": "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u4E16\u754C\u4E4B\u65C5", "type": "configured_variant" }]
    },
    "Ragnarok M Eternal Love": {
      "search_variants": [{ "query": "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u5B88\u8B77\u6C38\u6046\u7684\u611B", "type": "configured_variant" }]
    },
    "Ragnarok M: Classic": {
      "search_variants": [{ "query": "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u5B88\u8B77\u6C38\u6046\u7684\u611B Classic", "type": "configured_variant" }]
    },
    "Ragnarok Origin Classic": {
      "search_variants": [{ "query": "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u611B\u5982\u521D\u898B Classic", "type": "configured_variant" }]
    },
    "Ragnarok X: Next Generation": {
      "search_variants": [
        { "query": "Ragnarok X", "type": "configured_variant" },
        { "query": "RO\u4ED9\u5883\u50B3\u8AAA\uFF1A\u65B0\u4E16\u4EE3\u7684\u8A95\u751F", "type": "configured_variant" }
      ]
    }
  }
}
'@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, $config, $utf8NoBom)

$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chromePath)) { $chromePath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" }
if (-not (Test-Path $chromePath)) { throw "Google Chrome was not found." }

Write-Status "Starting Chrome CDP at $Cdp with user data dir $UserDataDir"
$chromeStart = Get-Date
$port = 9222
if ($Cdp -match ":(\d+)(?:/|$)") { $port = [int]$Matches[1] }
Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=$UserDataDir",
  "https://www.facebook.com/"
) | Out-Null
Start-Sleep -Seconds 5

$games = "Ragnarok: The New World,Ragnarok M Eternal Love,Ragnarok M: Classic,Ragnarok Origin Classic,Ragnarok X: Next Generation,Ragnarok: Midgard Senki"
$indexPath = Join-Path $RunDir "phase1_index.json"

Write-Status "Phase1 started"
& node scripts\phase1_collect_candidates.js --games $games --out-dir $RunDir --config $configPath --cdp $Cdp *> $phase1Log
if (-not (Test-Path $indexPath)) { throw "phase1_index.json not generated" }
Write-Status "Phase1 completed"

Write-Status "Phase2 started"
& node scripts\phase2_collect_details.js `
  --index $indexPath `
  --threshold 10 `
  --snapshot-date 2026-06-09 `
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
  --checkpoint-every 1 `
  --checkpoint-every-candidate 1 `
  --cdp $Cdp *> $phase2Log
Write-Status "Phase2 completed"

Write-Status "Strict cleaning started"
& node scripts\clean_ragnarok_batch_strict.js --dir $RunDir --out (Join-Path $RunDir "fb_monitoring_filtered_strict_cleaned.xlsx") --summary (Join-Path $RunDir "fb_monitoring_filtered_strict_cleaned_summary.json") *> $cleanLog
Write-Status "Strict cleaning completed"

Write-Status "Closing Chrome processes started after $($chromeStart.ToString('yyyy-MM-dd HH:mm:ss'))"
Get-Process chrome -ErrorAction SilentlyContinue |
  Where-Object { $_.StartTime -ge $chromeStart } |
  Stop-Process -Force -ErrorAction SilentlyContinue
Write-Status "Chrome close attempted"

$deadline = Get-Date "2026-06-10 13:30:00"
$now = Get-Date
if ($now -lt $deadline) {
  Write-Status "Completed before deadline; shutting down computer now"
  Stop-Computer -Force
} else {
  Write-Status "Completed after shutdown deadline; leaving computer on"
}
