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
  [switch]$FreshStart,
  [switch]$DirectBackground,
  [switch]$NoPowerGuard,
  [int]$PowerGuardPollSeconds = 5,
  [int]$ChromeStartTimeoutSeconds = 180,
  [string]$ScheduledTaskName = "",
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

# V6.0: phase2 background tasks use Windows Task Scheduler by default.
# The task has an immediate trigger plus an AtLogOn trigger, so a Windows restart can resume the same run.
# The scheduled runner self-deletes the task after every normal execution end.
if ($Task -eq "phase2" -and -not $DirectBackground) {
  if ([string]::IsNullOrWhiteSpace($Index)) {
    $candidateIndex = Join-Path $RunDir "phase1_index.json"
    if (Test-Path $candidateIndex) { $Index = $candidateIndex }
  }
  if ([string]::IsNullOrWhiteSpace($Index)) { throw "phase2 需要 -Index，或 -RunDir 中已存在 phase1_index.json。" }
  $Index = (Resolve-Path $Index).Path
  if (-not [string]::IsNullOrWhiteSpace($Config)) { $Config = (Resolve-Path $Config).Path }

  if ([string]::IsNullOrWhiteSpace($ScheduledTaskName)) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($RunDir.ToLowerInvariant())
      $hash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').Substring(0, 16)
      $ScheduledTaskName = "FBGroupMonitor_Phase2_$hash"
    } finally {
      $sha.Dispose()
    }
  }

  $tsScheduled = Get-Date -Format "yyyyMMdd_HHmmss"
  $StdoutLog = Join-Path $RunDir "scheduled_phase2_$tsScheduled.stdout.log"
  $StderrLog = Join-Path $RunDir "scheduled_phase2_$tsScheduled.stderr.log"
  $StatusFile = Join-Path $RunDir "background_task.json"
  $Manifest = Join-Path $RunDir "scheduled_phase2_manifest.json"
  $Runner = Join-Path $RootDir "scripts\scheduled_phase2_runner.ps1"
  if (-not (Test-Path -LiteralPath $Runner)) { throw "缺少任务计划程序执行器：$Runner" }

  $existingTask = Get-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
  if ($existingTask -and $existingTask.State -eq 'Running') {
    $existingStatus = [ordered]@{
      task = $Task
      launch_mode = "windows_task_scheduler"
      scheduled_task_name = $ScheduledTaskName
      status = "already_running"
      run_dir = $RunDir
      started_at = (Get-Date).ToString("o")
      note = "同一 RunDir 的任务计划程序实例正在运行，未覆盖 manifest，也未创建重复实例。"
    }
    $existingStatus | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
    $existingStatus | ConvertTo-Json -Depth 5
    exit 0
  }

  $manifestPayload = [ordered]@{
    manifest_kind = "facebook_group_monitor_scheduled_phase2"
    manifest_version = 1
    root_dir = $RootDir
    run_dir = $RunDir
    index = $Index
    config = $Config
    threshold = $Threshold
    cdp = $Cdp
    progress_report_every_minutes = $ProgressReportEveryMinutes
    no_close_chrome = [bool]$NoCloseChrome
    fresh_start = [bool]$FreshStart
    shutdown_after_complete = [bool]$ShutdownAfterComplete
    shutdown_delay_seconds = $ShutdownDelaySeconds
    enable_power_guard = [bool](-not $NoPowerGuard)
    power_guard_poll_seconds = [Math]::Max(2, $PowerGuardPollSeconds)
    chrome_start_timeout_seconds = [Math]::Max(30, $ChromeStartTimeoutSeconds)
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    out_xlsx = (Join-Path $RunDir "fb_monitoring_filtered.xlsx")
    out_summary = (Join-Path $RunDir "fb_monitoring_filtered_summary.json")
    out_collision = (Join-Path $RunDir "collision_report.json")
    out_audit = (Join-Path $RunDir "audit_stats.json")
    out_debug_rows = (Join-Path $RunDir "debug_rows.json")
    created_at = (Get-Date).ToString("o")
  }
  $manifestPayload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $Manifest -Encoding UTF8

  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $argString = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Runner`" -Manifest `"$Manifest`" -TaskName `"$ScheduledTaskName`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argString -WorkingDirectory $RootDir
  $triggers = @(
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)),
    (New-ScheduledTaskTrigger -AtLogOn -User $userId)
  )
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero)
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

  # Reusing the same RunDir replaces only a non-running stale task with the deterministic name.
  if ($existingTask) {
    Unregister-ScheduledTask -TaskName $ScheduledTaskName -Confirm:$false -ErrorAction SilentlyContinue
  }
  Register-ScheduledTask -TaskName $ScheduledTaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "Facebook Group Monitor phase 2; reboot-resumable; self-deletes after execution." -Force | Out-Null
  Start-ScheduledTask -TaskName $ScheduledTaskName

  $status = [ordered]@{
    task = $Task
    launch_mode = "windows_task_scheduler"
    scheduled_task_name = $ScheduledTaskName
    scheduled_task_self_delete = $true
    scheduled_task_resume_trigger = "AtLogOn"
    started_at = (Get-Date).ToString("o")
    run_dir = $RunDir
    manifest = $Manifest
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    cdp = $Cdp
    progress_file = (Join-Path $RunDir "codex_progress_report.json")
    phase2_progress_file = (Join-Path $RunDir "phase2_progress.json")
    final_xlsx = (Join-Path $RunDir "fb_monitoring_filtered.xlsx")
    completion_file = (Join-Path $RunDir "codex_task_complete.json")
    recoverable_checkpoint = (Join-Path $RunDir "phase2_autosave_state.json")
    runtime_power_guard = [bool](-not $NoPowerGuard)
    runtime_power_guard_status = (Join-Path $RunDir "runtime_power_guard_status.json")
    auto_resume_phase2 = [bool](-not $FreshStart)
    fresh_start = [bool]$FreshStart
    shutdown_after_complete = [bool]$ShutdownAfterComplete
    shutdown_delay_seconds = $ShutdownDelaySeconds
    shutdown_validation = "final_xlsx + summary + collision + audit + debug_rows + finalized checkpoint + finalized progress + completion token"
    note = "第二轮已交给 Windows 任务计划程序；系统重启后在用户登录时自动续跑。任务正常结束后会自删除。"
  }
  $status | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
  $status | ConvertTo-Json -Depth 7
  exit 0
}
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
  if ($FreshStart) {
    $cmd.Add('--fresh-start') | Out-Null
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
  auto_resume_phase2 = [bool](-not $FreshStart)
  fresh_start = [bool]$FreshStart
  shutdown_after_complete = [bool]$ShutdownAfterComplete
  shutdown_delay_seconds = $ShutdownDelaySeconds
  shutdown_force_apps = [bool]$ShutdownAfterComplete
  shutdown_watcher_file = (Join-Path $RunDir "conditional_shutdown_watcher_status.json")
  note = "后台任务已启动；当前 PowerShell/Codex 命令会立即结束，聊天输入框可继续输入。"
}
$status | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $StatusFile -Encoding UTF8
$status | ConvertTo-Json -Depth 5
