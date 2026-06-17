param(
  [string]$Cdp = "http://127.0.0.1:9222",
  [string]$UserDataDir = "C:\temp\chrome-cdp"
)

$ErrorActionPreference = "Stop"

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  $chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
}
if (-not (Test-Path $chrome)) {
  throw "Google Chrome was not found. Please install Chrome or update this script path."
}

$port = 9222
if ($Cdp -match ":(\d+)(?:/|$)") {
  $port = [int]$Matches[1]
}

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=$UserDataDir",
  "https://www.facebook.com/"
)

Write-Host "Chrome started. CDP=$Cdp UserDataDir=$UserDataDir. Please log in to Facebook manually."
