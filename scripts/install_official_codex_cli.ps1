param(
  [ValidateSet('OfficialInstaller', 'Npm')]
  [string]$Method = 'OfficialInstaller'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

Write-Host "Installing the standalone Codex CLI using method: $Method"
Write-Host "The Codex desktop app execution alias is not used by this installer."

if ($Method -eq 'Npm') {
  $npm = Get-Command npm -ErrorAction Stop
  & $npm.Source install -g '@openai/codex'
  if ($LASTEXITCODE -ne 0) { throw "npm install -g @openai/codex failed with exit code $LASTEXITCODE" }
} else {
  $scriptText = Invoke-RestMethod -Uri 'https://chatgpt.com/codex/install.ps1' -UseBasicParsing
  if (-not $scriptText) { throw 'The official Codex installer script was empty.' }
  & ([scriptblock]::Create([string]$scriptText))
}

$possiblePathAdds = @(
  (Join-Path $HOME '.local\bin'),
  (Join-Path $env:APPDATA 'npm')
) | Where-Object { $_ -and (Test-Path $_) }
foreach ($item in $possiblePathAdds) {
  if (($env:Path -split ';') -notcontains $item) { $env:Path = "$item;$env:Path" }
}

Write-Host 'Installation command completed.'
Write-Host 'Next steps:'
Write-Host '  1. Run: codex login status'
Write-Host '  2. If needed, run: codex login'
Write-Host '  3. Run: npm run semantic:verify-codex'
