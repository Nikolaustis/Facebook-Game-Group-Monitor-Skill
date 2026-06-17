param(
  [int]$WaitPid = 12532,
  [string]$CurrentRunDir = "runs\one_piece_bounty_fighting_20260521_160359",
  [string]$Cdp = "http://127.0.0.1:9222"
)

$ErrorActionPreference = "Stop"

Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

$currentRun = Resolve-Path $CurrentRunDir
$currentFinalXlsx = Join-Path $currentRun "fb_monitoring_filtered.xlsx"
$logDir = Resolve-Path "runs"
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$runDir = Join-Path $logDir "soul_land_batch_$ts"
$logPath = Join-Path $runDir "watchdog.log"

New-Item -ItemType Directory -Force -Path $runDir | Out-Null

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Host $line
}

Write-Log "Waiting for current One Piece phase2 to finish. pid=$WaitPid final_xlsx=$currentFinalXlsx"

while ($true) {
  $pidRunning = $false
  if ($WaitPid -gt 0) {
    $pidRunning = [bool](Get-Process -Id $WaitPid -ErrorAction SilentlyContinue)
  }
  $finalExists = Test-Path $currentFinalXlsx
  if (-not $pidRunning -and $finalExists) {
    break
  }
  Write-Log "Still waiting. pid_running=$pidRunning final_xlsx_exists=$finalExists"
  Start-Sleep -Seconds 60
}

Write-Log "Current One Piece run is complete. Starting Soul Land batch."

$games = @(
  "Soul Land : Awakening World",
  "Soul Land: New World",
  "Soul Land: Time Reversed"
)

$config = [ordered]@{
  games = $games
  aliases = [ordered]@{
    "Soul Land : Awakening World" = @()
    "Soul Land: New World" = @()
    "Soul Land: Time Reversed" = @()
  }
  sibling_titles = [ordered]@{
    "Soul Land : Awakening World" = @("Soul Land: New World", "Soul Land: Time Reversed")
    "Soul Land: New World" = @("Soul Land : Awakening World", "Soul Land: Time Reversed")
    "Soul Land: Time Reversed" = @("Soul Land : Awakening World", "Soul Land: New World")
  }
  ip_roots = [ordered]@{
    "Soul Land : Awakening World" = @()
    "Soul Land: New World" = @()
    "Soul Land: Time Reversed" = @()
  }
  threshold = 10
  progress_report_every_minutes = 30
  allowed_language_signals = @()
  allowed_regions = @()
  language_to_region = [ordered]@{
    Thai = "TH"
    Vietnamese = "VN"
    Chinese = ""
    English = ""
    Spanish = ""
    Portuguese = ""
    Indonesian = "ID"
    Malay = "MY"
    Filipino = "PH"
    Japanese = ""
    Korean = ""
    French = ""
    German = ""
    Russian = ""
    Arabic = ""
    Turkish = ""
    Hindi = ""
    Mixed = ""
    Unknown = ""
  }
  region_keywords = [ordered]@{
    TH = @("th", "thai", "thailand")
    VN = @("vn", "viet nam", "vietnam", "viet nam")
    PH = @("ph", "pinoy", "philippines", "pilipinas")
    ID = @("id", "indo", "indonesia")
    MY = @("malaysia")
    SG = @("sg", "singapore")
    LATAM = @("latam", "latham", "latin america", "latinoamerica", "america latina")
    MX = @("mexico", "mexicano", "mexicana")
    ES = @("spain", "espana")
    AR = @("argentina")
    CL = @("chile")
    CO = @("colombia")
    PE = @("peru")
    BR = @("br", "brasil", "brazil")
    US = @("usa", "u.s.", "u.s.a.", "united states")
    CA = @("canada")
    UK = @("uk", "u.k.", "united kingdom")
    AU = @("australia")
    JP = @("jp", "japan")
    KR = @("kr", "korea", "korean")
    TW = @("tw", "taiwan")
    HK = @("hk", "hong kong")
    CN = @("cn", "china")
    IN = @("india", "bharat")
    RU = @("russia")
    TR = @("turkey", "turkiye")
    DE = @("germany", "deutschland")
    FR = @("france")
  }
  cdp_url = $Cdp
  snapshot_date = (Get-Date -Format "yyyy-MM-dd")
  title_variant_overrides = [ordered]@{
    "Soul Land : Awakening World" = [ordered]@{
      search_variants_only = $true
      search_variants = @([ordered]@{ query = "Soul Land : Awakening World"; type = "canonical" })
    }
    "Soul Land: New World" = [ordered]@{
      search_variants_only = $true
      search_variants = @([ordered]@{ query = "Soul Land: New World"; type = "canonical" })
    }
    "Soul Land: Time Reversed" = [ordered]@{
      search_variants_only = $true
      search_variants = @([ordered]@{ query = "Soul Land: Time Reversed"; type = "canonical" })
    }
  }
}

$configPath = Join-Path $runDir "task_config.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8NoBom)

$gamesArg = ($games -join ",")

Write-Log "Phase1 starting. run_dir=$runDir"
& node ".\scripts\phase1_collect_candidates.js" --games $gamesArg --out-dir $runDir --config $configPath --cdp $Cdp *>&1 |
  ForEach-Object { Write-Log $_ }

$indexPath = Join-Path $runDir "phase1_index.json"
if (-not (Test-Path $indexPath)) {
  throw "phase1_index.json was not created: $indexPath"
}

Write-Log "Phase2 starting immediately."
& node ".\scripts\phase2_collect_details.js" --index $indexPath --threshold 10 --out-xlsx (Join-Path $runDir "fb_monitoring_filtered.xlsx") --out-summary (Join-Path $runDir "fb_monitoring_filtered_summary.json") --out-collision (Join-Path $runDir "collision_report.json") --out-audit (Join-Path $runDir "audit_stats.json") --config $configPath --cdp $Cdp *>&1 |
  ForEach-Object { Write-Log $_ }

Write-Log "Soul Land batch complete. output=$runDir"
