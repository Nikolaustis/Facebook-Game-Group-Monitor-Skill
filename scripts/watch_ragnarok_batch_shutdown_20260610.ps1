param(
  [Parameter(Mandatory = $true)]
  [string]$RunDir,
  [string]$Deadline = "2026-06-10 13:30:00"
)

$ErrorActionPreference = "Stop"
$RunDir = (Resolve-Path $RunDir).Path
$deadlineAt = Get-Date $Deadline
$statusLog = Join-Path $RunDir "shutdown_watcher.log"
$finalXlsx = Join-Path $RunDir "fb_monitoring_filtered.xlsx"
$cleanedXlsx = Join-Path $RunDir "fb_monitoring_filtered_strict_cleaned.xlsx"

function Log($Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')] $Message"
  Add-Content -Path $statusLog -Value $line -Encoding UTF8
}

Log "Watcher started. Deadline=$($deadlineAt.ToString('yyyy-MM-dd HH:mm:ss')) RunDir=$RunDir"

while ((Get-Date) -lt $deadlineAt) {
  if ((Test-Path $finalXlsx) -and (Test-Path $cleanedXlsx)) {
    Log "Final and cleaned workbooks detected. Closing Chrome."
    Get-Process chrome -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 5
    Log "Completed before deadline; shutting down computer."
    Stop-Computer -Force
    exit 0
  }
  Start-Sleep -Seconds 60
}

Log "Deadline reached before final outputs were detected; leaving computer on."
