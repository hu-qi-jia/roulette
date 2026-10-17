param(
  [int]$Dx = 0,
  [int]$Dy = -120,
  [string]$FocusTitle = ""
)

# Test helper: press the click-mode shortcut, move into a sector, and click.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ClickWheel {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
}
"@

if ($FocusTitle) {
  try {
    [Microsoft.VisualBasic.Interaction]::AppActivate($FocusTitle) | Out-Null
    Write-Output "focused: $FocusTitle"
  } catch {
    Write-Warning "focus failed: $_"
  }
  Start-Sleep -Milliseconds 600
}

# Ctrl+Shift+Space
[ClickWheel]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
[ClickWheel]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[ClickWheel]::keybd_event(0x20, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[ClickWheel]::keybd_event(0x20, 0, 2, [UIntPtr]::Zero)
[ClickWheel]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero)
[ClickWheel]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)

Start-Sleep -Milliseconds 700

$origin = [System.Windows.Forms.Cursor]::Position
[ClickWheel]::SetCursorPos($origin.X + $Dx, $origin.Y + $Dy) | Out-Null
Start-Sleep -Milliseconds 250
[ClickWheel]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[ClickWheel]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)

Write-Output "clicked sector at $($origin.X + $Dx),$($origin.Y + $Dy)"
