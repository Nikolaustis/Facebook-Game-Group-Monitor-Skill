param(
  [Parameter(Mandatory = $true)][string]$CurrentRunDir,
  [Parameter(Mandatory = $true)][string]$Index,
  [Parameter(Mandatory = $true)][string]$RunDir,
  [string]$Config = '',
  [string]$Cdp = 'http://127.0.0.1:9222',
  [int]$Threshold = 10,
  [int]$PollSeconds = 15,
  [int]$MaxStartAttempts = 10,
  [int]$RetryIntervalSeconds = 60,
  [int]$StartupHealthTimeoutSeconds = 180,
  [string]$RetryUntil = '',
  [ValidateSet('none','after_complete','before_deadline')][string]$ShutdownMode = 'none',
  [string]$ShutdownDeadline = '',
  [string]$ShutdownInstruction = '',
  [int]$ShutdownDelaySeconds = 0,
  [string]$StatusFile = ''
)

$ErrorActionPreference = 'Stop'
$RootDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$CurrentRunDir = [System.IO.Path]::GetFullPath($CurrentRunDir)
$RunDir = [System.IO.Path]::GetFullPath($RunDir)
$Index = [System.IO.Path]::GetFullPath($Index)
if (-not [string]::IsNullOrWhiteSpace($Config)) { $Config = [System.IO.Path]::GetFullPath($Config) }
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
if ([string]::IsNullOrWhiteSpace($StatusFile)) { $StatusFile = Join-Path $RunDir 'phase2_handoff_status.json' }
$StatusFile = [System.IO.Path]::GetFullPath($StatusFile)
$LogFile = Join-Path $RunDir 'phase2_handoff.log'
$CurrentCompletion = Join-Path $CurrentRunDir 'codex_task_complete.json'
$TargetProgress = Join-Path $RunDir 'phase2_progress.json'
$TargetRunnerStatus = Join-Path $RunDir 'scheduled_phase2_runner_status.json'
$InputValidation = Join-Path $RunDir 'phase2_input_validation.json'
$retryDeadline = $null
if (-not [string]::IsNullOrWhiteSpace($RetryUntil)) {
  try { $retryDeadline = [DateTimeOffset]::Parse($RetryUntil) }
  catch { throw '-RetryUntil must be an ISO 8601 timestamp with timezone.' }
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-Status([string]$Status, [hashtable]$Extra = @{}) {
  $payload = [ordered]@{
    handoff_kind = 'facebook_group_monitor_phase2_handoff'
    version = '6.6.2'
    status = $Status
    current_run_dir = $CurrentRunDir
    target_run_dir = $RunDir
    target_index = $Index
    target_config = $Config
    current_completion_file = $CurrentCompletion
    target_progress_file = $TargetProgress
    target_runner_status = $TargetRunnerStatus
    handoff_pid = $PID
    updated_at = (Get-Date).ToString('o')
  }
  foreach ($key in $Extra.Keys) { $payload[$key] = $Extra[$key] }
  $tmp = "$StatusFile.tmp-$PID-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
  Write-Utf8NoBom $tmp ($payload | ConvertTo-Json -Depth 12)
  Move-Item -Force -LiteralPath $tmp -Destination $StatusFile
  Add-Content -LiteralPath $LogFile -Value "[$((Get-Date).ToString('o'))] $Status"
}

function Read-Json([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $offset = 0
  $encoding = New-Object System.Text.UTF8Encoding($false, $true)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $offset = 3 }
  elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) { $encoding = [System.Text.Encoding]::Unicode; $offset = 2 }
  elseif ($bytes.Length -ge 2 -and $bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) { $encoding = [System.Text.Encoding]::BigEndianUnicode; $offset = 2 }
  $text = $encoding.GetString($bytes, $offset, $bytes.Length - $offset)
  return $text.TrimStart([char]0xFEFF) | ConvertFrom-Json
}

function Current-TaskCompleted {
  try {
    $payload = Read-Json $CurrentCompletion
    return $payload -and $payload.final_report_generated -eq $true -and $payload.phase2_finalization_verified -eq $true
  } catch { return $false }
}

function Retry-Allowed([int]$Attempt) {
  if ($Attempt -ge [Math]::Max(1, $MaxStartAttempts)) { return $false }
  if ($retryDeadline -and [DateTimeOffset]::Now -ge $retryDeadline) { return $false }
  return $true
}

Write-Status 'waiting_for_current_facebook_task' @{ started_at = (Get-Date).ToString('o') }
while (-not (Current-TaskCompleted)) { Start-Sleep -Seconds ([Math]::Max(5, $PollSeconds)) }
Write-Status 'current_task_completed' @{ current_completed_at = (Get-Date).ToString('o') }

$validationArgs = @((Join-Path $RootDir 'scripts\validate_phase2_inputs.js'),'--index',$Index,'--out-report',$InputValidation)
if (-not [string]::IsNullOrWhiteSpace($Config)) { $validationArgs += @('--config',$Config) }
& node @validationArgs 1>> $LogFile 2>> $LogFile
if ($LASTEXITCODE -ne 0) {
  Write-Status 'input_validation_failed' @{ validation_report = $InputValidation; exit_code = $LASTEXITCODE }
  exit 2
}
Write-Status 'input_validation_passed' @{ validation_report = $InputValidation }

$starter = Join-Path $RootDir 'scripts\start_background_task.ps1'
for ($attempt = 1; ; $attempt++) {
  Write-Status 'phase2_start_attempt' @{ attempt = $attempt; max_attempts = $MaxStartAttempts }
  $startArgs = @('-Task','phase2','-Index',$Index,'-RunDir',$RunDir,'-Cdp',$Cdp,'-Threshold',[string]$Threshold,'-Phase2HealthTimeoutSeconds',[string]$StartupHealthTimeoutSeconds,'-ShutdownMode',$ShutdownMode,'-ShutdownDelaySeconds',[string]$ShutdownDelaySeconds)
  if (-not [string]::IsNullOrWhiteSpace($Config)) { $startArgs += @('-Config',$Config) }
  if ($ShutdownMode -eq 'before_deadline') { $startArgs += @('-ShutdownDeadline',$ShutdownDeadline) }
  if (-not [string]::IsNullOrWhiteSpace($ShutdownInstruction)) { $startArgs += @('-ShutdownInstruction',$ShutdownInstruction) }

  $output = & $starter @startArgs 2>&1
  $exitCode = $LASTEXITCODE
  Add-Content -LiteralPath $LogFile -Value ($output | Out-String)
  $runner = $null
  try { $runner = Read-Json $TargetRunnerStatus } catch {}
  $progress = $null
  try { $progress = Read-Json $TargetProgress } catch {}
  $healthy = $exitCode -eq 0 -and $runner -and $runner.status -eq 'phase2_running' -and $runner.startup_verified -eq $true -and $progress
  if ($healthy) {
    Write-Status 'phase2_started_verified' @{
      attempt = $attempt
      runner_pid = $runner.runner_pid
      phase2_child_pid = $runner.phase2_child_pid
      progress_stage = if ($progress.progress) { $progress.progress.stage } else { $progress.stage }
      started_at = (Get-Date).ToString('o')
    }
    exit 0
  }

  $stderrTail = ''
  try {
    $stderrCandidate = Get-ChildItem -LiteralPath $RunDir -Filter 'scheduled_phase2_*.stderr.log' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($stderrCandidate) { $stderrTail = (Get-Content -LiteralPath $stderrCandidate.FullName -Tail 80 | Out-String) }
  } catch {}
  Write-Status 'phase2_start_failed' @{
    attempt = $attempt
    exit_code = $exitCode
    runner_status = if ($runner) { $runner.status } else { 'missing' }
    startup_verified = if ($runner) { [bool]$runner.startup_verified } else { $false }
    stderr_tail = $stderrTail
    will_retry = (Retry-Allowed $attempt)
  }
  if (-not (Retry-Allowed $attempt)) { exit 3 }
  Start-Sleep -Seconds ([Math]::Max(10, $RetryIntervalSeconds))
}
