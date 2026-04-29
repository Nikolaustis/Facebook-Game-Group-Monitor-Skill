$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
if (-not (Test-Path $chrome)) {
  throw "未找到Chrome: $chrome"
}

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=C:\temp\chrome-cdp",
  "https://www.facebook.com/"
)

Write-Host "Chrome started. Please log in to Facebook manually."
