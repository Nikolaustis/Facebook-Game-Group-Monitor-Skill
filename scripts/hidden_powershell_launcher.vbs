Option Explicit

' V6.2.0: resilient windowless launcher for Task Scheduler.
' Usage:
'   wscript.exe //B //Nologo hidden_powershell_launcher.vbs <bootstrap.ps1> <trace.log> <task-name>
'
' The launcher first uses WMI Win32_Process.Create with ShowWindow=0. If WMI process
' creation is unavailable, it falls back to WScript.Shell.Run with window style 0.
' Only a generated bootstrap script path is forwarded, which avoids the multi-layer
' argument quoting failure seen in V6.1.0.

Dim shell, fso, bootstrapPath, tracePath, taskName, psExe, commandLine
Dim wmi, startup, processClass, createResult, childPid, usedFallback, exitCode

If WScript.Arguments.Count < 2 Then
  WScript.Quit 87
End If

bootstrapPath = CStr(WScript.Arguments(0))
tracePath = CStr(WScript.Arguments(1))
If WScript.Arguments.Count >= 3 Then
  taskName = CStr(WScript.Arguments(2))
Else
  taskName = ""
End If

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

Sub AppendTrace(message)
  On Error Resume Next
  Dim parentDir, stream
  parentDir = fso.GetParentFolderName(tracePath)
  If Len(parentDir) > 0 And Not fso.FolderExists(parentDir) Then
    fso.CreateFolder parentDir
  End If
  Set stream = fso.OpenTextFile(tracePath, 8, True, -1)
  stream.WriteLine Now & vbTab & message
  stream.Close
  Set stream = Nothing
  On Error GoTo 0
End Sub

Function QuoteArgument(value)
  Dim s
  s = CStr(value)
  s = Replace(s, Chr(34), Chr(34) & Chr(34))
  QuoteArgument = Chr(34) & s & Chr(34)
End Function

Function ProcessExists(pid)
  On Error Resume Next
  Dim results
  Set results = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId=" & CStr(pid))
  ProcessExists = (Err.Number = 0 And results.Count > 0)
  Set results = Nothing
  Err.Clear
  On Error GoTo 0
End Function

Sub DeleteFailedScheduledTask()
  On Error Resume Next
  If Len(taskName) > 0 Then
    shell.Run "schtasks.exe /Delete /TN " & QuoteArgument(taskName) & " /F", 0, True
    AppendTrace "failed_launcher_task_delete_requested task=" & taskName
  End If
  On Error GoTo 0
End Sub

If Not fso.FileExists(bootstrapPath) Then
  AppendTrace "bootstrap_missing path=" & bootstrapPath
  DeleteFailedScheduledTask
  WScript.Quit 2
End If

psExe = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
If Not fso.FileExists(psExe) Then
  psExe = "powershell.exe"
End If

commandLine = QuoteArgument(psExe) & _
  " -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
  QuoteArgument(bootstrapPath)

AppendTrace "launcher_started task=" & taskName
AppendTrace "bootstrap=" & bootstrapPath
AppendTrace "powershell=" & psExe

usedFallback = False
childPid = 0
createResult = -1

On Error Resume Next
Set wmi = GetObject("winmgmts:{impersonationLevel=impersonate}!\\.\root\cimv2")
If Err.Number = 0 Then
  Set startup = wmi.Get("Win32_ProcessStartup").SpawnInstance_
  startup.ShowWindow = 0
  Set processClass = wmi.Get("Win32_Process")
  createResult = processClass.Create(commandLine, fso.GetParentFolderName(bootstrapPath), startup, childPid)
Else
  AppendTrace "wmi_connect_error number=" & Err.Number & " description=" & Err.Description
End If
Err.Clear
On Error GoTo 0

If createResult = 0 And childPid > 0 Then
  AppendTrace "wmi_child_started pid=" & childPid
  Do While ProcessExists(childPid)
    WScript.Sleep 1000
  Loop
  AppendTrace "wmi_child_exited pid=" & childPid
  WScript.Quit 0
End If

AppendTrace "wmi_create_failed result=" & createResult & " pid=" & childPid
usedFallback = True

On Error Resume Next
exitCode = shell.Run(commandLine, 0, True)
If Err.Number <> 0 Then
  AppendTrace "shell_run_error number=" & Err.Number & " description=" & Err.Description
  Err.Clear
  DeleteFailedScheduledTask
  WScript.Quit 3
End If
On Error GoTo 0

AppendTrace "shell_run_exited exit_code=" & exitCode
WScript.Quit exitCode
