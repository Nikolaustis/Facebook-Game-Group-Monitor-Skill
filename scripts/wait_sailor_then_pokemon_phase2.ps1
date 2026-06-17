param(
  [int]$SailorPid = 25944,
  [string]$SailorXlsx = "C:\Work\Crawler\fb-group-monitor-skill-v2\fb-group-monitor-skill-v2\runs\seal_cross_sailor_piece_phase1_20260525_1812\fb_monitoring_filtered.xlsx",
  [string]$PokemonIndex = "C:\Work\Crawler\fb-group-monitor-skill-v2\fb-group-monitor-skill-v2\output\pokemon_go_phase1_20260525_rerun\phase1_index.json",
  [string]$OutDir = "C:\Work\Crawler\fb-group-monitor-skill-v2\fb-group-monitor-skill-v2\runs\pokemon_go_phase2_20260527",
  [string]$SnapshotDate = "2026-05-27"
)

$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$LogFile = Join-Path $OutDir "wait_sailor_then_pokemon_phase2.log"

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Wait-FileStable {
  param(
    [string]$Path,
    [int]$StableChecks = 3,
    [int]$SleepSeconds = 20
  )

  $sameCount = 0
  $lastLength = -1
  while ($sameCount -lt $StableChecks) {
    if (-not (Test-Path -LiteralPath $Path)) {
      $sameCount = 0
      $lastLength = -1
      Start-Sleep -Seconds $SleepSeconds
      continue
    }

    $item = Get-Item -LiteralPath $Path
    if ($item.Length -gt 0 -and $item.Length -eq $lastLength) {
      $sameCount++
    } else {
      $sameCount = 0
      $lastLength = $item.Length
    }
    Start-Sleep -Seconds $SleepSeconds
  }
}

Write-Log "Watcher started. Waiting for Sailor Piece PID $SailorPid."
while (Get-Process -Id $SailorPid -ErrorAction SilentlyContinue) {
  Start-Sleep -Seconds 60
}

Write-Log "Sailor Piece process ended. Waiting for stable Excel: $SailorXlsx"
Wait-FileStable -Path $SailorXlsx

if (-not (Test-Path -LiteralPath $PokemonIndex)) {
  throw "Pokemon phase1 index not found: $PokemonIndex"
}

$node = "node"
$phase2 = ".\scripts\phase2_collect_details.js"
$args = @(
  $phase2,
  "--index", $PokemonIndex,
  "--out-xlsx", (Join-Path $OutDir "fb_monitoring_filtered.xlsx"),
  "--out-summary", (Join-Path $OutDir "fb_monitoring_filtered_summary.json"),
  "--out-collision", (Join-Path $OutDir "collision_report.json"),
  "--out-audit", (Join-Path $OutDir "audit_stats.json"),
  "--out-partial-xlsx", (Join-Path $OutDir "partial_verified_rows.xlsx"),
  "--out-codex-progress", (Join-Path $OutDir "codex_progress_report.json"),
  "--snapshot-date", $SnapshotDate,
  "--cdp", "http://127.0.0.1:9222",
  "--progress-report-every-minutes", "30",
  "--resume", "true"
)

Write-Log "Starting Pokemon Go phase2."
Write-Log ("Command: node " + ($args -join " "))

Push-Location "C:\Work\Crawler\fb-group-monitor-skill-v2\fb-group-monitor-skill-v2"
try {
  & $node @args *> (Join-Path $OutDir "pokemon_go_phase2_node.log")
  $exitCode = $LASTEXITCODE
  Write-Log "Pokemon Go phase2 finished with exit code $exitCode."
  exit $exitCode
} finally {
  Pop-Location
}
