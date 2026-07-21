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
  [int]$SchedulerStartupTimeoutSeconds = 45,
  [int]$Phase2HealthTimeoutSeconds = 180,
  [string]$ScheduledTaskName = "",
  [switch]$ShutdownAfterComplete,
  [string]$ShutdownBefore = "",
  [ValidateSet("auto", "none", "after_complete", "before_deadline")]
  [string]$ShutdownMode = "auto",
  [string]$ShutdownDeadline = "",
  [string]$ShutdownInstruction = "",
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

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-JsonAtomic([string]$Path, $Payload) {
  $dir = Split-Path -Parent $Path
  if ($dir) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $tmp = "$Path.tmp-$PID-$(Get-Date -Format 'yyyyMMddHHmmssfff')"
  Write-Utf8NoBom $tmp ($Payload | ConvertTo-Json -Depth 12)
  Move-Item -Force -LiteralPath $tmp -Destination $Path
}

function ConvertTo-NativeQuotedArgument([string]$Value) {
  if ($null -eq $Value) { return '""' }
  $text = [string]$Value
  if ($text -notmatch '[\s"]') { return $text }
  $builder = New-Object System.Text.StringBuilder
  [void]$builder.Append('"')
  $backslashes = 0
  foreach ($ch in $text.ToCharArray()) {
    if ($ch -eq '\') { $backslashes++; continue }
    if ($ch -eq '"') {
      [void]$builder.Append(('\' * (($backslashes * 2) + 1)))
      [void]$builder.Append('"')
      $backslashes = 0
      continue
    }
    if ($backslashes -gt 0) { [void]$builder.Append(('\' * $backslashes)); $backslashes = 0 }
    [void]$builder.Append($ch)
  }
  if ($backslashes -gt 0) { [void]$builder.Append(('\' * ($backslashes * 2))) }
  [void]$builder.Append('"')
  return $builder.ToString()
}

function Start-HiddenPowerShellProcess([string]$ScriptPath) {
  $powerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $powerShellExe)) { $powerShellExe = 'powershell.exe' }
  $parts = @('-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$ScriptPath) |
    ForEach-Object { ConvertTo-NativeQuotedArgument ([string]$_) }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $powerShellExe
  $psi.Arguments = ($parts -join ' ')
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $psi
  if (-not $process.Start()) { throw "无法启动隐藏 PowerShell：$ScriptPath" }
  return $process
}

function Get-RunnerHealth([string]$RunnerStatusPath) {
  $result = [ordered]@{ healthy = $false; observed = $false; terminal = $false; terminal_success = $false; terminal_failure = $false; status = 'missing'; runner_pid = $null; process_alive = $false; payload = $null }
  if (-not (Test-Path -LiteralPath $RunnerStatusPath)) { return [pscustomobject]$result }
  try {
    $payload = Get-Content -Raw -LiteralPath $RunnerStatusPath | ConvertFrom-Json
    $result.payload = $payload
    $result.observed = $true
    $result.status = [string]$payload.status
    if ($payload.runner_pid) {
      $result.runner_pid = [int]$payload.runner_pid
      $result.process_alive = $null -ne (Get-Process -Id ([int]$payload.runner_pid) -ErrorAction SilentlyContinue)
    }
    $result.healthy = $result.process_alive -and ($result.status -eq 'phase2_running') -and ($payload.startup_verified -eq $true)
    $result.terminal_success = ($result.status -eq 'already_completed_noop') -or (($result.status -eq 'finished_success') -and ($payload.startup_verified -eq $true))
    $result.terminal_failure = $result.status -in @('finished_error','runner_error','phase2_startup_failed','phase2_startup_timeout','duplicate_instance_ignored')
    $result.terminal = $result.terminal_success -or $result.terminal_failure
  } catch {
    $result.status = 'invalid_status_json'
  }
  return [pscustomobject]$result
}

function Remove-ScheduledTaskRobust([string]$Name) {
  try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue } catch {}
  try { Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  try { & schtasks.exe /Delete /TN $Name /F *> $null } catch {}
}


function Stop-StaleLauncherChildFromTrace([string]$TracePath) {
  if (-not (Test-Path -LiteralPath $TracePath)) { return }
  try {
    $lines = @(Get-Content -LiteralPath $TracePath -Tail 50)
    $pidMatches = New-Object System.Collections.Generic.List[int]
    foreach ($line in $lines) {
      if ([string]$line -match 'wmi_child_started pid=(\d+)') { $pidMatches.Add([int]$Matches[1]) | Out-Null }
    }
    foreach ($childPid in ($pidMatches | Select-Object -Unique)) {
      $runnerHealth = Get-RunnerHealth (Join-Path (Split-Path -Parent $TracePath) 'scheduled_phase2_runner_status.json')
      if (-not $runnerHealth.healthy -and (Get-Process -Id $childPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
      }
    }
  } catch {}
}

function Wait-ForRunnerStart([string]$RunnerStatusPath, [string]$BootstrapStatusPath, [int]$TimeoutSeconds) {
  $deadline = (Get-Date).AddSeconds([Math]::Max(10, $TimeoutSeconds))
  $lastBootstrap = $null
  while ((Get-Date) -lt $deadline) {
    $health = Get-RunnerHealth $RunnerStatusPath
    if ($health.healthy -or $health.terminal_success) { return [pscustomobject]@{ started = $true; health = $health; bootstrap = $lastBootstrap } }
    if ($health.terminal_failure) { return [pscustomobject]@{ started = $false; health = $health; bootstrap = $lastBootstrap } }
    if (Test-Path -LiteralPath $BootstrapStatusPath) {
      try {
        $lastBootstrap = Get-Content -Raw -LiteralPath $BootstrapStatusPath | ConvertFrom-Json
        if ([string]$lastBootstrap.status -eq 'bootstrap_error') {
          return [pscustomobject]@{ started = $false; health = $health; bootstrap = $lastBootstrap }
        }
      } catch {}
    }
    Start-Sleep -Seconds 1
  }
  return [pscustomobject]@{ started = $false; health = (Get-RunnerHealth $RunnerStatusPath); bootstrap = $lastBootstrap }
}

function Set-ManifestLauncherMode([string]$ManifestPath, [string]$Mode) {
  try {
    $payload = Get-Content -Raw -LiteralPath $ManifestPath | ConvertFrom-Json
    $payload.launcher_mode = $Mode
    $payload.launcher_mode_updated_at = (Get-Date).ToString('o')
    Write-JsonAtomic $ManifestPath $payload
  } catch {}
}

$RootDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

# Shutdown intent is resolved from the current Codex prompt into a run-local
# shutdown_policy.json. The user never needs to edit task_config.json or a fixed date.
$legacyDeadline = if (-not [string]::IsNullOrWhiteSpace($ShutdownDeadline)) { $ShutdownDeadline } else { $ShutdownBefore }
$ResolvedShutdownMode = ([string]$ShutdownMode).Trim().ToLowerInvariant()
if ($ResolvedShutdownMode -eq 'auto') {
  if (-not [string]::IsNullOrWhiteSpace($legacyDeadline)) {
    $ResolvedShutdownMode = 'before_deadline'
  } elseif ([bool]$ShutdownAfterComplete) {
    $ResolvedShutdownMode = 'after_complete'
  } else {
    $ResolvedShutdownMode = 'none'
  }
}

$ShutdownBefore = ''
if ($ResolvedShutdownMode -eq 'before_deadline') {
  if ([string]::IsNullOrWhiteSpace($legacyDeadline)) {
    throw "ShutdownMode=before_deadline requires -ShutdownDeadline (or legacy -ShutdownBefore) with a timezone."
  }
  try { $ShutdownBefore = ([DateTimeOffset]::Parse($legacyDeadline)).ToString('o') }
  catch { throw "-ShutdownDeadline must be an ISO 8601 timestamp with a timezone, such as YYYY-MM-DDTHH:mm:ss+08:00." }
} elseif ($ResolvedShutdownMode -eq 'after_complete') {
  $ShutdownBefore = ''
} elseif ($ResolvedShutdownMode -eq 'none') {
  $ShutdownBefore = ''
} else {
  throw "不支持的 ShutdownMode：$ResolvedShutdownMode"
}
$EffectiveShutdownAfterComplete = $ResolvedShutdownMode -in @('after_complete', 'before_deadline')

if ([string]::IsNullOrWhiteSpace($RunDir)) {
  if ($Task -eq "phase2" -and -not [string]::IsNullOrWhiteSpace($Index)) {
    $RunDir = Split-Path -Parent (Resolve-Path $Index).Path
  } else {
    $ts = Get-Date -Format "yyyyMMdd_HHmmss"
    $RunDir = Join-Path $RootDir "runs\${Task}_$ts"
  }
}

$RunDir = (Resolve-Path (New-Item -ItemType Directory -Force -Path $RunDir)).Path

$ShutdownPolicyFile = Join-Path $RunDir 'shutdown_policy.json'
$shutdownPolicyPayload = [ordered]@{
  policy_kind = 'facebook_group_monitor_shutdown_policy'
  policy_version = 1
  mode = $ResolvedShutdownMode
  enabled = [bool]$EffectiveShutdownAfterComplete
  deadline = $ShutdownBefore
  delay_seconds = [Math]::Max(0, $ShutdownDelaySeconds)
  force_apps = [bool]$EffectiveShutdownAfterComplete
  default_when_unspecified = 'none'
  source = if (-not [string]::IsNullOrWhiteSpace($ShutdownInstruction)) { 'codex_natural_language_prompt' } else { 'codex_cli_resolution' }
  user_instruction = $ShutdownInstruction
  resolved_at = (Get-Date).ToString('o')
  note = 'This file is generated automatically from the user instruction in the Codex text box. The user should not edit it manually.'
}
Write-JsonAtomic $ShutdownPolicyFile $shutdownPolicyPayload

# Phase 2 defaults to a resilient, fully hidden Task Scheduler chain.
# A generated one-argument bootstrap avoids multi-layer quoting failures.
# Startup is actively verified. A stuck WScript task is removed and retried with a
# direct hidden Task Scheduler action; if that also fails, a hidden direct process
# starts from the same complete checkpoint rather than silently doing nothing.
if ($Task -eq "phase2" -and -not $DirectBackground) {
  if ([string]::IsNullOrWhiteSpace($Index)) {
    $candidateIndex = Join-Path $RunDir "phase1_index.json"
    if (Test-Path $candidateIndex) { $Index = $candidateIndex }
  }
  if ([string]::IsNullOrWhiteSpace($Index)) { throw "phase2 requires -Index, or phase1_index.json in -RunDir." }
  $Index = (Resolve-Path $Index).Path
  if (-not [string]::IsNullOrWhiteSpace($Config)) { $Config = (Resolve-Path $Config).Path }

  $InputValidation = Join-Path $RunDir 'phase2_input_validation.json'
  $validationArgs = @((Join-Path $RootDir 'scripts\validate_phase2_inputs.js'),'--index',$Index,'--out-report',$InputValidation,'--shutdown-policy-file',$ShutdownPolicyFile)
  if (-not [string]::IsNullOrWhiteSpace($Config)) { $validationArgs += @('--config',$Config) }
  & node @validationArgs
  if ($LASTEXITCODE -ne 0) { throw "Phase 2 input validation failed. See: $InputValidation" }

  if ([string]::IsNullOrWhiteSpace($ScheduledTaskName)) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($RunDir.ToLowerInvariant())
      $hash = ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').Substring(0, 16)
      $ScheduledTaskName = "FBGroupMonitor_Phase2_$hash"
    } finally { $sha.Dispose() }
  }

  $tsScheduled = Get-Date -Format "yyyyMMdd_HHmmss"
  $StdoutLog = Join-Path $RunDir "scheduled_phase2_$tsScheduled.stdout.log"
  $StderrLog = Join-Path $RunDir "scheduled_phase2_$tsScheduled.stderr.log"
  $StatusFile = Join-Path $RunDir "background_task.json"
  $Manifest = Join-Path $RunDir "scheduled_phase2_manifest.json"
  $Runner = Join-Path $RootDir "scripts\scheduled_phase2_runner.ps1"
  $RunnerStatus = Join-Path $RunDir "scheduled_phase2_runner_status.json"
  $BootstrapStatus = Join-Path $RunDir "scheduled_phase2_bootstrap_status.json"
  $LauncherTrace = Join-Path $RunDir "scheduled_phase2_launcher_trace.log"
  $SchedulerDiagnostic = Join-Path $RunDir "scheduled_phase2_startup_diagnostic.json"
  $Bootstrap = Join-Path $RunDir "scheduled_phase2_bootstrap_$tsScheduled.ps1"
  if (-not (Test-Path -LiteralPath $Runner)) { throw "缺少任务计划程序执行器：$Runner" }

  $existingTask = Get-ScheduledTask -TaskName $ScheduledTaskName -ErrorAction SilentlyContinue
  if ($existingTask -and $existingTask.State -eq 'Running') {
    $existingHealth = Get-RunnerHealth $RunnerStatus
    if (-not $existingHealth.healthy) {
      Start-Sleep -Seconds 5
      $existingHealth = Get-RunnerHealth $RunnerStatus
    }
    if ($existingHealth.healthy) {
      $existingStatus = [ordered]@{
        task = $Task
        launch_mode = 'windows_task_scheduler'
        scheduled_task_name = $ScheduledTaskName
        status = 'already_running_verified'
        runner_pid = $existingHealth.runner_pid
        run_dir = $RunDir
        started_at = (Get-Date).ToString('o')
        note = 'A live runner was detected; the manifest was preserved and no duplicate instance was created.'
      }
      Write-JsonAtomic $StatusFile $existingStatus
      $existingStatus | ConvertTo-Json -Depth 7
      exit 0
    }
    # WScript may remain Running while no runner exists. Do not treat it as healthy.
    Remove-ScheduledTaskRobust $ScheduledTaskName
  } elseif ($existingTask) {
    Remove-ScheduledTaskRobust $ScheduledTaskName
  }

  Remove-Item -Force -LiteralPath $RunnerStatus,$BootstrapStatus,$LauncherTrace,$SchedulerDiagnostic -ErrorAction SilentlyContinue

  $manifestPayload = [ordered]@{
    manifest_kind = "facebook_group_monitor_scheduled_phase2"
    manifest_version = 5
    root_dir = $RootDir
    run_dir = $RunDir
    index = $Index
    config = $Config
    threshold = $Threshold
    cdp = $Cdp
    progress_report_every_minutes = $ProgressReportEveryMinutes
    no_close_chrome = [bool]$NoCloseChrome
    fresh_start = [bool]$FreshStart
    shutdown_mode = $ResolvedShutdownMode
    shutdown_policy_file = $ShutdownPolicyFile
    shutdown_instruction = $ShutdownInstruction
    shutdown_after_complete = [bool]$EffectiveShutdownAfterComplete
    shutdown_before = $ShutdownBefore
    shutdown_delay_seconds = $ShutdownDelaySeconds
    enable_power_guard = [bool](-not $NoPowerGuard)
    power_guard_poll_seconds = [Math]::Max(2, $PowerGuardPollSeconds)
    chrome_start_timeout_seconds = [Math]::Max(30, $ChromeStartTimeoutSeconds)
    scheduler_startup_timeout_seconds = [Math]::Max(10, $SchedulerStartupTimeoutSeconds)
    phase2_health_timeout_seconds = [Math]::Max(30, $Phase2HealthTimeoutSeconds)
    input_validation_report = $InputValidation
    launcher_mode = 'wscript_wmi_windowless'
    bootstrap_script = $Bootstrap
    bootstrap_status = $BootstrapStatus
    launcher_trace = $LauncherTrace
    scheduler_diagnostic = $SchedulerDiagnostic
    stdout_log = $StdoutLog
    stderr_log = $StderrLog
    out_xlsx = (Join-Path $RunDir "fb_monitoring_filtered.xlsx")
    out_summary = (Join-Path $RunDir "fb_monitoring_filtered_summary.json")
    out_collision = (Join-Path $RunDir "collision_report.json")
    out_audit = (Join-Path $RunDir "audit_stats.json")
    out_debug_rows = (Join-Path $RunDir "debug_rows.json")
    created_at = (Get-Date).ToString("o")
  }
  Write-JsonAtomic $Manifest $manifestPayload

  $bootstrapLines = New-Object System.Collections.Generic.List[string]
  $bootstrapLines.Add('$ErrorActionPreference = ''Stop''') | Out-Null
  $bootstrapLines.Add(('$statusPath = ' + (Quote-PSString $BootstrapStatus))) | Out-Null
  $bootstrapLines.Add(('$stderrPath = ' + (Quote-PSString $StderrLog))) | Out-Null
  $bootstrapLines.Add('function Write-BootstrapStatus([string]$Status, [string]$ErrorMessage = '''') {') | Out-Null
  $bootstrapLines.Add('  $payload = [ordered]@{ status=$Status; bootstrap_pid=$PID; updated_at=(Get-Date).ToString(''o''); error=$ErrorMessage }') | Out-Null
  $bootstrapLines.Add('  $tmp = "$statusPath.tmp-$PID"; [System.IO.File]::WriteAllText($tmp, ($payload | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding($false))); Move-Item -Force -LiteralPath $tmp -Destination $statusPath') | Out-Null
  $bootstrapLines.Add('}') | Out-Null
  $bootstrapLines.Add('Write-BootstrapStatus ''bootstrap_started''') | Out-Null
  $bootstrapLines.Add('try {') | Out-Null
  $bootstrapLines.Add(('  & ' + (Quote-PSString $Runner) + ' -Manifest ' + (Quote-PSString $Manifest) + ' -TaskName ' + (Quote-PSString $ScheduledTaskName))) | Out-Null
  $bootstrapLines.Add('  exit $LASTEXITCODE') | Out-Null
  $bootstrapLines.Add('} catch {') | Out-Null
  $bootstrapLines.Add('  $message = $_.Exception.ToString(); Add-Content -LiteralPath $stderrPath -Value "[bootstrap] fatal_at=$((Get-Date).ToString(''o''))`n$message"; Write-BootstrapStatus ''bootstrap_error'' $message; exit 1') | Out-Null
  $bootstrapLines.Add('}') | Out-Null
  Write-Utf8NoBom $Bootstrap ($bootstrapLines -join [Environment]::NewLine)

  $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $HiddenLauncher = Join-Path $RootDir "scripts\hidden_powershell_launcher.vbs"
  if (-not (Test-Path -LiteralPath $HiddenLauncher)) { throw "缺少无窗口启动器：$HiddenLauncher" }
  $WscriptExe = Join-Path $env:SystemRoot "System32\wscript.exe"
  if (-not (Test-Path -LiteralPath $WscriptExe)) { $WscriptExe = "wscript.exe" }
  $PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  if (-not (Test-Path -LiteralPath $PowerShellExe)) { $PowerShellExe = 'powershell.exe' }

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

  function Register-AndStartPhase2Task([string]$LauncherMode) {
    if ($LauncherMode -eq 'wscript_wmi_windowless') {
      $arguments = "//B //Nologo `"$HiddenLauncher`" `"$Bootstrap`" `"$LauncherTrace`" `"$ScheduledTaskName`""
      $action = New-ScheduledTaskAction -Execute $WscriptExe -Argument $arguments -WorkingDirectory $RootDir
    } else {
      $arguments = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Bootstrap`""
      $action = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $arguments -WorkingDirectory $RootDir
    }
    Register-ScheduledTask -TaskName $ScheduledTaskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Description "Facebook Group Monitor V6.6.0 phase 2; verified startup; reboot-resumable; self-deletes after execution." -Force | Out-Null
    Start-ScheduledTask -TaskName $ScheduledTaskName
  }

  $attempts = New-Object System.Collections.Generic.List[object]
  Register-AndStartPhase2Task 'wscript_wmi_windowless'
  $first = Wait-ForRunnerStart $RunnerStatus $BootstrapStatus ([Math]::Max(60, $ChromeStartTimeoutSeconds + $Phase2HealthTimeoutSeconds + 30))
  $attempts.Add([ordered]@{
    mode = 'wscript_wmi_windowless'
    started = [bool]$first.started
    checked_at = (Get-Date).ToString('o')
    bootstrap = $first.bootstrap
    runner = $first.health
  }) | Out-Null

  $effectiveMode = 'wscript_wmi_windowless'
  $fallbackProcess = $null
  if (-not $first.started) {
    Remove-ScheduledTaskRobust $ScheduledTaskName
    Stop-StaleLauncherChildFromTrace $LauncherTrace
    Remove-Item -Force -LiteralPath $RunnerStatus,$BootstrapStatus -ErrorAction SilentlyContinue
    Set-ManifestLauncherMode $Manifest 'task_scheduler_direct_powershell_hidden'
    Register-AndStartPhase2Task 'task_scheduler_direct_powershell_hidden'
    $second = Wait-ForRunnerStart $RunnerStatus $BootstrapStatus ([Math]::Max(60, $ChromeStartTimeoutSeconds + $Phase2HealthTimeoutSeconds + 30))
    $attempts.Add([ordered]@{
      mode = 'task_scheduler_direct_powershell_hidden'
      started = [bool]$second.started
      checked_at = (Get-Date).ToString('o')
      bootstrap = $second.bootstrap
      runner = $second.health
    }) | Out-Null
    $effectiveMode = 'task_scheduler_direct_powershell_hidden'

    if (-not $second.started) {
      Remove-ScheduledTaskRobust $ScheduledTaskName
      Remove-Item -Force -LiteralPath $RunnerStatus,$BootstrapStatus -ErrorAction SilentlyContinue
      Set-ManifestLauncherMode $Manifest 'hidden_direct_emergency_fallback'
      $fallbackProcess = Start-HiddenPowerShellProcess $Bootstrap
      $third = Wait-ForRunnerStart $RunnerStatus $BootstrapStatus ([Math]::Max(60, $ChromeStartTimeoutSeconds + $Phase2HealthTimeoutSeconds + 30))
      $attempts.Add([ordered]@{
        mode = 'hidden_direct_emergency_fallback'
        started = [bool]$third.started
        process_id = $fallbackProcess.Id
        checked_at = (Get-Date).ToString('o')
        bootstrap = $third.bootstrap
        runner = $third.health
      }) | Out-Null
      $effectiveMode = 'hidden_direct_emergency_fallback'
      if (-not $third.started) {
        try { Stop-Process -Id $fallbackProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
        $diagnostic = [ordered]@{
          status = 'all_launch_methods_failed'
          task_name = $ScheduledTaskName
          run_dir = $RunDir
          attempts = $attempts
          created_at = (Get-Date).ToString('o')
        }
        Write-JsonAtomic $SchedulerDiagnostic $diagnostic
        Remove-Item -Force -LiteralPath $Manifest,$Bootstrap -ErrorAction SilentlyContinue
        throw "三种隐藏启动方式均未进入 runner。诊断文件：$SchedulerDiagnostic"
      }
    }
  }

  $diagnostic = [ordered]@{
    status = 'runner_started'
    task_name = $ScheduledTaskName
    run_dir = $RunDir
    effective_launch_mode = $effectiveMode
    attempts = $attempts
    created_at = (Get-Date).ToString('o')
  }
  Write-JsonAtomic $SchedulerDiagnostic $diagnostic

  $status = [ordered]@{
    task = $Task
    launch_mode = if ($effectiveMode -eq 'hidden_direct_emergency_fallback') { 'hidden_direct_emergency_fallback' } else { 'windows_task_scheduler' }
    effective_launcher = $effectiveMode
    scheduled_task_name = if ($effectiveMode -eq 'hidden_direct_emergency_fallback') { $null } else { $ScheduledTaskName }
    scheduled_task_self_delete = $true
    scheduled_task_resume_trigger = if ($effectiveMode -eq 'hidden_direct_emergency_fallback') { $null } else { 'AtLogOn' }
    powershell_window_visible = $false
    startup_verified = $true
    started_at = (Get-Date).ToString("o")
    run_dir = $RunDir
    manifest = $Manifest
    bootstrap = $Bootstrap
    bootstrap_status = $BootstrapStatus
    launcher_trace = $LauncherTrace
    scheduler_diagnostic = $SchedulerDiagnostic
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
    shutdown_mode = $ResolvedShutdownMode
    shutdown_policy_file = $ShutdownPolicyFile
    shutdown_instruction = $ShutdownInstruction
    shutdown_after_complete = [bool]$EffectiveShutdownAfterComplete
    shutdown_before = $ShutdownBefore
    shutdown_delay_seconds = $ShutdownDelaySeconds
    shutdown_validation = "final_xlsx + summary + collision + audit + debug_rows + finalized checkpoint + finalized progress + shutdown request token + runner coordinator"
    note = if ($effectiveMode -eq 'hidden_direct_emergency_fallback') {
      'Both scheduler launch paths failed health checks. Failed tasks were removed and a hidden direct process was used; restart recovery is unavailable for this run.'
    } else {
      'The scheduled runner passed input parsing and phase2 progress health checks with no visible PowerShell window; shutdown coordination remains in the runner.'
    }
  }
  Write-JsonAtomic $StatusFile $status
  $status | ConvertTo-Json -Depth 10
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
  if ([string]::IsNullOrWhiteSpace($Games)) { throw "phase1 requires -Games." }
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
  if ([string]::IsNullOrWhiteSpace($Index)) { throw "phase2 requires -Index, or phase1_index.json in -RunDir." }
  $Index = (Resolve-Path $Index).Path
  if (-not [string]::IsNullOrWhiteSpace($Config)) { $Config = (Resolve-Path $Config).Path }
  $InputValidation = Join-Path $RunDir 'phase2_input_validation.json'
  $validationArgs = @((Join-Path $RootDir 'scripts\validate_phase2_inputs.js'),'--index',$Index,'--out-report',$InputValidation,'--shutdown-policy-file',$ShutdownPolicyFile)
  if (-not [string]::IsNullOrWhiteSpace($Config)) { $validationArgs += @('--config',$Config) }
  & node @validationArgs
  if ($LASTEXITCODE -ne 0) { throw "Phase 2 input validation failed. See: $InputValidation" }
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
  $cmd.Add('--shutdown-policy-file') | Out-Null
  Add-QuotedArg $cmd $ShutdownPolicyFile
  $cmd.Add('--shutdown-wait-pid') | Out-Null
  $cmd.Add('$PID') | Out-Null
  $cmd.Add('--shutdown-coordinator-mode') | Out-Null
  Add-QuotedArg $cmd 'runner'
  if (-not [string]::IsNullOrWhiteSpace($Config)) {
    $cmd.Add('--config') | Out-Null
    Add-QuotedArg $cmd $Config
  }
  $lines.Add(($cmd -join ' ')) | Out-Null
  $lines.Add('$exitCode = $LASTEXITCODE') | Out-Null
  $coordinatorScript = Join-Path $RootDir 'scripts\verified_shutdown_coordinator.ps1'
  $coordinatorStdout = Join-Path $RunDir 'shutdown_coordinator.stdout.log'
  $coordinatorStderr = Join-Path $RunDir 'shutdown_coordinator.stderr.log'
  $lines.Add(('if ($exitCode -eq 0 -and (Test-Path -LiteralPath ' + (Quote-PSString $coordinatorScript) + ')) {')) | Out-Null
  $lines.Add(('  & ' + (Quote-PSString $coordinatorScript) + ' -RunDir ' + (Quote-PSString $RunDir) + ' 1>> ' + (Quote-PSString $coordinatorStdout) + ' 2>> ' + (Quote-PSString $coordinatorStderr))) | Out-Null
  $lines.Add('  $shutdownCoordinatorExitCode = $LASTEXITCODE') | Out-Null
  $lines.Add('}') | Out-Null
} elseif ($Task -eq "monitor") {
  if ([string]::IsNullOrWhiteSpace($Games)) { throw "monitor requires -Games." }
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
  if ($EffectiveShutdownAfterComplete) {
    $cmd.Add('-ShutdownAfterComplete') | Out-Null
    $cmd.Add('-ShutdownDelaySeconds') | Out-Null
    Add-QuotedArg $cmd ([string]$ShutdownDelaySeconds)
    if ($ResolvedShutdownMode -eq 'before_deadline') {
      $cmd.Add('-ShutdownBefore') | Out-Null
      Add-QuotedArg $cmd $ShutdownBefore
    }
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
Write-Utf8NoBom $Wrapper ($lines -join [Environment]::NewLine)

$process = Start-Process -FilePath "powershell.exe" -ArgumentList @(
  "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden", "-File", $Wrapper
) -RedirectStandardOutput $StdoutLog -RedirectStandardError $StderrLog -PassThru -WindowStyle Hidden

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
  shutdown_mode = $ResolvedShutdownMode
  shutdown_policy_file = $ShutdownPolicyFile
  shutdown_instruction = $ShutdownInstruction
  shutdown_after_complete = [bool]$EffectiveShutdownAfterComplete
  shutdown_before = $ShutdownBefore
  shutdown_delay_seconds = $ShutdownDelaySeconds
  shutdown_force_apps = [bool]$EffectiveShutdownAfterComplete
  shutdown_coordinator_file = (Join-Path $RunDir "shutdown_coordinator_status.json")
  shutdown_watcher_file = (Join-Path $RunDir "conditional_shutdown_watcher_status.json")
  powershell_window_visible = $false
  launch_mode = "hidden_start_process"
  note = "The background task was started with hidden-window settings; the current PowerShell/Codex command can exit."
}
Write-Utf8NoBom $StatusFile ($status | ConvertTo-Json -Depth 5)
$status | ConvertTo-Json -Depth 5
