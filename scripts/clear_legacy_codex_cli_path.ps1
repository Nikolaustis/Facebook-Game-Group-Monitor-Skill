param(
  [switch]$IncludeMachine
)

$ErrorActionPreference = 'Stop'
$legacyName = 'CODEX_CLI_PATH'

# Clear the current PowerShell process immediately.
Remove-Item "Env:$legacyName" -ErrorAction SilentlyContinue

# Clear the current user's persistent value. This is the value most likely to
# affect the Codex/ChatGPT desktop application at startup.
[Environment]::SetEnvironmentVariable($legacyName, $null, 'User')
Write-Host "Cleared $legacyName from the current process and User environment."

if ($IncludeMachine) {
  try {
    [Environment]::SetEnvironmentVariable($legacyName, $null, 'Machine')
    Write-Host "Cleared $legacyName from the Machine environment."
  } catch {
    throw "Unable to clear Machine-level $legacyName. Re-run PowerShell as Administrator or clear it manually. $($_.Exception.Message)"
  }
}

Write-Host 'Restart the Codex/ChatGPT desktop application after changing persistent environment variables.'
Write-Host 'The Skill will discover Codex from PATH/npm or use semantic_region_resolver.codex_exec.command.'
Write-Host 'Optional Skill-private override: FB_MONITOR_CODEX_CLI_PATH.'
