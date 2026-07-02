param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("login", "validate-login", "phase1", "phase2", "monitor")]
  [string]$Task,
  [string]$Games = "",
  [int]$Threshold = 10,
  [string]$RunDir = "",
  [string]$Index = "",
  [string]$Config = "",
  [string]$Cdp = "http://127.0.0.1:9222",
  [int]$ProgressReportEveryMinutes = 30,
  [switch]$NoCloseChrome,
  [switch]$ShutdownAfterComplete,
  [int]$ShutdownDelaySeconds = 60
)

$ErrorActionPreference = "Stop"

function Quote-PSString([string]$Value) {
  if ($null -eq $Value) { return "''" }
  return "'" + ($Value -replace "'", "''") + "'"
}

function Add-QuotedArg([System.Collections.Generic.List[string]]$List, [string]$Value) {
  $List.Add((Quote-PSString $Value)) | Out-Null
}

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  if ($Task -eq "phase2" -and -not [string]::IsNullOrWhiteSpace($Index)) {
    $RunDir = Split-Path -Parent (Resolve-Path $Index).Path
  } else {
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $RunDir = Join-Path $RootDir "runs\${Task}_$ts"
  }
}

$RunDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $RunDir)).Path
$ts2 = Get-Date -Format "yyyyMMdd_HHmmss"
$TaskSafe = $Task -replace "[^A-Za-z0-9_-]", "_"
$Wrapper = Join-Path $RunDir "background_${TaskSafe}_$ts2.ps1"
$StdoutLog = Join-Path $RunDir "background_${TaskSafe}_$ts2.stdout.log"
$StderrLog = Join-Path $RunDir "background_${TaskSafe}_$ts2.stderr.log"
$StatusFile = Join-Path $RunDir "background_task.json"

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('$ErrorActionPreference = "Stop"') | Out-Null
$lines.Add(('Set-Location -LiteralPath ' + (Quote-PSString $RootDir))) | Out-Null
$lines.Add('$startedAt = Get-Date') | Out-Null
$lines.Add(('"[background] started_at=$($startedAt.ToString("o")) task=' + $Task + ' run_dir=' + $RunDir + '"')) | Out-Null

if ($Task -eq "login") {
  $cmd = New-Object System.Collections.Generic.List[string]
  $cmd.Add('&') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RootDir "scripts\open_chrome_9222.ps1")
  $cmd.Add('-Cdp') | Out-Null
  Add-QuotedArg $cmd $Cdp
  $lines.Add(($cmd -join ' ')) | Out-Null
  $lines.Add('$exitCode = 0') | Out-Null
} elseif ($Task -eq "validate-login") {
  $cmd = New-Object System.Collections.Generic.List[string]
  $cmd.Add('& node') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RootDir "scripts\validate_login_state.js")
  $cmd.Add('--cdp') | Out-Null
  Add-QuotedArg $cmd $Cdp
  $cmd.Add('--out-status') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RunDir "login_state.json")
  if (-not [string]::IsNullOrWhiteSpace($Config)) {
    $cmd.Add('--config') | Out-Null
    Add-QuotedArg $cmd $Config
  }
  $lines.Add(($cmd -join ' ')) | Out-Null
  $lines.Add('$exitCode = $LASTEXITCODE') | Out-Null
} elseif ($Task -eq "phase1") {
  if ([string]::IsNullOrWhiteSpace($Games)) { throw "phase1 需要 -Games。" }
  $cmd = New-Object System.Collections.Generic.List[string]
  $cmd.Add('& node') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RootDir "scripts\phase1_collect_candidates.js")
  $cmd.Add('--games') | Out-Null
  Add-QuotedArg $cmd $Games
  $cmd.Add('--out-dir') | Out-Null
  Add-QuotedArg $cmd $RunDir
  $cmd.Add('--cdp') | Out-Null
  Add-QuotedArg $cmd $Cdp
  $cmd.Add('--progress-report-every-minutes') | Out-Null
  Add-QuotedArg $cmd ([string]$ProgressReportEveryMinutes)
  if (-not [string]::IsNullOrWhiteSpace($Config)) {
    $cmd.Add('--config') | Out-Null
    Add-QuotedArg $cmd $Config
  }
  $lines.Add(($cmd -join ' ')) | Out-Null
  $lines.Add('$exitCode = $LASTEXITCODE') | Out-Null
} elseif ($Task -eq "phase2") {
  if ([string]::IsNullOrWhiteSpace($Index)) {
    $candidateIndex = Join-Path $RunDir "phase1_index.json"
    if (Test-Path $candidateIndex) { $Index = $candidateIndex }
  }
  if ([string]::IsNullOrWhiteSpace($Index)) { throw "phase2 需要 -Index，或 -RunDir 中已存在 phase1_index.json。" }
  $Index = (Resolve-Path $Index).Path
  $cmd = New-Object System.Collections.Generic.List[string]
  $cmd.Add('& node') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RootDir "scripts\phase2_collect_details.js")
  $cmd.Add('--index') | Out-Null
  Add-QuotedArg $cmd $Index
  $cmd.Add('--threshold') | Out-Null
  Add-QuotedArg $cmd ([string]$Threshold)
  $cmd.Add('--out-xlsx') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RunDir "fb_monitoring_filtered.xlsx")
  $cmd.Add('--out-summary') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RunDir "fb_monitoring_filtered_summary.json")
  $cmd.Add('--out-collision') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RunDir "collision_report.json")
  $cmd.Add('--out-audit') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RunDir "audit_stats.json")
  $cmd.Add('--out-debug-rows') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RunDir "debug_rows.json")
  $cmd.Add('--cdp') | Out-Null
  Add-QuotedArg $cmd $Cdp
  $cmd.Add('--progress-report-every-minutes') | Out-Null
  Add-QuotedArg $cmd ([string]$ProgressReportEveryMinutes)
  if ($NoCloseChrome) {
    $cmd.Add('--no-close-chrome') | Out-Null
    Add-QuotedArg $cmd "true"
  }
  if ($ShutdownAfterComplete) {
    $cmd.Add('--shutdown-after-complete') | Out-Null
    Add-QuotedArg $cmd "true"
    $cmd.Add('--shutdown-delay-seconds') | Out-Null
    Add-QuotedArg $cmd ([string]$ShutdownDelaySeconds)
  }
  if (-not [string]::IsNullOrWhiteSpace($Config)) {
    $cmd.Add('--config') | Out-Null
    Add-QuotedArg $cmd $Config
  }
  $lines.Add(($cmd -join ' ')) | Out-Null
  $lines.Add('$exitCode = $LASTEXITCODE') | Out-Null
} elseif ($Task -eq "monitor") {
  if ([string]::IsNullOrWhiteSpace($Games)) { throw "monitor 需要 -Games。" }
  $cmd = New-Object System.Collections.Generic.List[string]
  $cmd.Add('&') | Out-Null
  Add-QuotedArg $cmd (Join-Path $RootDir "scripts\run_multi_games_v2.ps1")
  $cmd.Add('-Games') | Out-Null
  Add-QuotedArg $cmd $Games
  $cmd.Add('-Threshold') | Out-Null
  Add-QuotedArg $cmd ([string]$Threshold)
  $cmd.Add('-RunDir') | Out-Null
  Add-QuotedArg $cmd $RunDir
  $cmd.Add('-Cdp') | Out-Null
  Add-QuotedArg $cmd $Cdp
  if ($ShutdownAfterComplete) {
    $cmd.Add('-ShutdownAfterComplete') | Out-Null
    $cmd.Add('-ShutdownDelaySeconds') | Out-Null
    Add-QuotedArg $cmd ([string]$ShutdownDelaySeconds)
  }
  if (-not [string]::IsNullOrWhiteSpace($Config)) {
    $cmd.Add('-Config') | Out-Null
    Add-QuotedArg $cmd $Config
  }
  $lines.Add(($cmd -join ' ')) | Out-Null
  $lines.Add('$exitCode = $LASTEXITCODE') | Out-Null
}

$lines.Add('$finishedAt = Get-Date') | Out-Null
$lines.Add('"[background] finished_at=$($finishedAt.ToString("o")) exit_code=$exitCode"') | Out-Null
$lines.Add('exit $exitCode') | Out-Null
Set-Content -LiteralPath $Wrapper -Value ($lines -join [Environment]::NewLine) -Encoding UTF8

$process = Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Wrapper) -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru -WindowStyle Hidden

$status = [ordered]@{
  task = $Task
  pid = $process.Id
  started_at = (Get-Date).ToString("o")
  run_dir = $RunDir
  wrapper = $Wrapper
  stdout_log = $StdoutLog
  stderr_log = $StderrLog
  cdp = $Cdp
  progress_file = (Join-Path $RunDir "codex_progress_report.json")
  phase2_progress_file = (Join-Path $RunDir "phase2_progress.json")
  login_state_file = (Join-Path $RunDir "login_state.json")
  final_xlsx = (Join-Path $RunDir "fb_monitoring_filtered.xlsx")
  completion_file = (Join-Path $RunDir "codex_task_complete.json")
  shutdown_after_complete = [bool]$ShutdownAfterComplete
  shutdown_delay_seconds = $ShutdownDelaySeconds
  shutdown_force_apps = [bool]$ShutdownAfterComplete
  shutdown_watcher_file = (Join-Path $RunDir "conditional_shutdown_watcher_status.json")
  note = "后台任务已启动；当前 PowerShell/Codex 命令会立即结束，聊天输入框可继续输入。"
}
$status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
$status | ConvertTo-Json -Depth 5
