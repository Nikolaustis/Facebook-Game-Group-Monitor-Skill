param(
  [Parameter(Mandatory = $true)]
  [string]$Games,
  [int]$Threshold = 10,
  [string]$RunDir = "",
  [string]$Cdp = "http://127.0.0.1:9222",
  [string]$Config = ""
)

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $RunDir = Join-Path $PSScriptRoot "..\runs\$ts"
}

$RunDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $RunDir)).Path

Write-Host "[1/3] 第一轮候选采集开始..."
node (Join-Path $PSScriptRoot "phase1_collect_candidates.js") `
  --games $Games `
  --out-dir $RunDir `
  --cdp $Cdp

$indexPath = Join-Path $RunDir "phase1_index.json"
if (-not (Test-Path $indexPath)) {
  throw "未生成 phase1_index.json，流程终止。"
}

Write-Host ""
Write-Host "已达到深翻页停止条件。请人工确认后继续。"
$confirm = Read-Host "输入 '可以停止，继续' 以进入第二轮"
if ($confirm -ne "可以停止，继续") {
  Write-Host "已取消第二轮。你可稍后手动执行 phase2_collect_details.js。"
  exit 0
}

Write-Host "[2/3] 第二轮详情采集开始..."
$phase2Args = @(
  (Join-Path $PSScriptRoot "phase2_collect_details.js"),
  "--index", $indexPath,
  "--threshold", $Threshold,
  "--out-csv", (Join-Path $RunDir "fb_monitoring_filtered.csv"),
  "--out-xlsx", (Join-Path $RunDir "fb_monitoring_filtered.xlsx"),
  "--out-summary", (Join-Path $RunDir "fb_monitoring_filtered_summary.json"),
  "--out-collision", (Join-Path $RunDir "collision_report.json"),
  "--out-audit", (Join-Path $RunDir "audit_stats.json"),
  "--cdp", $Cdp
)
if (-not [string]::IsNullOrWhiteSpace($Config)) {
  $phase2Args += @("--config", $Config)
}
node @phase2Args

Write-Host "[3/3] 完成。输出目录: $RunDir"
