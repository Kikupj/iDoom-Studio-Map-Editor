param(
  [string]$WadRelPath = "maps/live_playtest.wad",
  [string]$EnginePath = "",
  [string]$IwadPath = "freedoom-0.13.0/freedoom2.wad",
  [string]$ModDir = "",
  [string]$MapLump = "MAP01",
  [string]$Skill = "",
  [switch]$NoMonsters
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $RootDir "maps\uzdoom_launch.log"

try {
  "Launching UZDoom at $(Get-Date -Format o) from $RootDir" | Out-File -FilePath $logFile -Encoding utf8

  Stop-Process -Name "uzdoom" -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 150

  $uzExe = if ($EnginePath -ne "") { $EnginePath } else { Join-Path $RootDir "uzdoom.exe" }
  # the mod folder (a game profile's, e.g. New Bricks City's nbc) loads before the map
  $files = @()
  if ($ModDir -ne "") { $files += "`"$ModDir`"" }
  $files += $WadRelPath
  $argList = @("-iwad", "`"$IwadPath`"", "-file") + $files + @("+map", $MapLump)
  if ($Skill -ne "") {
    $argList += @("-skill", $Skill)
  }
  if ($NoMonsters) {
    $argList += "-nomonsters"
  }

  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@ -ErrorAction SilentlyContinue

  $wshell = New-Object -ComObject WScript.Shell -ErrorAction SilentlyContinue
  $proc = Start-Process -FilePath $uzExe -ArgumentList $argList -WorkingDirectory $RootDir -WindowStyle Normal -PassThru
  "Started uzdoom PID=$($proc.Id)" | Out-File -FilePath $logFile -Append -Encoding utf8

  $focused = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 200
    $proc.Refresh()
    if ($proc.HasExited) {
      "uzdoom exited with code $($proc.ExitCode)" | Out-File -FilePath $logFile -Append -Encoding utf8
      break
    }
    $hwnd = $proc.MainWindowHandle
    $title = $proc.MainWindowTitle
    if ($hwnd -and $hwnd -ne [IntPtr]::Zero -and $title -ne "") {
      if (-not $focused) {
        "Focusing HWND=$hwnd Title=$title" | Out-File -FilePath $logFile -Append -Encoding utf8
        [WinFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
        [WinFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
        [WinFocus]::BringWindowToTop($hwnd) | Out-Null
        [WinFocus]::SetForegroundWindow($hwnd) | Out-Null
        [WinFocus]::SwitchToThisWindow($hwnd, $true)
        if ($wshell) { $wshell.AppActivate($proc.Id) | Out-Null }
        $focused = $true
      } else {
        [WinFocus]::SetForegroundWindow($hwnd) | Out-Null
        "Verified alive after focus: HWND=$hwnd Title=$title" | Out-File -FilePath $logFile -Append -Encoding utf8
        break
      }
    }
  }
} catch {
  "ERROR: $($_.Exception.Message)" | Out-File -FilePath $logFile -Append -Encoding utf8
}
