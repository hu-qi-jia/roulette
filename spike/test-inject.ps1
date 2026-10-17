param(
  [int]$Dx = 0,
  [int]$Dy = -120,
  [int]$HoldMs = 700,
  [string]$FocusTitle = ""
)

# Spike-only: inject Alt + right-button down, move the cursor, release.
# The global hook should swallow the button events and report a selection.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

if ($FocusTitle) {
  try {
    [Microsoft.VisualBasic.Interaction]::AppActivate($FocusTitle) | Out-Null
    Write-Output "focused: $FocusTitle"
  } catch {
    Write-Warning "focus failed: $_"
  }
  Start-Sleep -Milliseconds 500
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class SpikeInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
}
"@

$origin = [System.Windows.Forms.Cursor]::Position
Write-Output "origin=$($origin.X),$($origin.Y) dx=$Dx dy=$Dy hold=$HoldMs"

# Alt down
[SpikeInput]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 80

# Right button down
[SpikeInput]::mouse_event(0x0008, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120

# Relative move so the low-level hook receives a real WM_MOUSEMOVE.
[SpikeInput]::mouse_event(0x0001, $Dx, $Dy, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds $HoldMs

# Right button up
[SpikeInput]::mouse_event(0x0010, 0, 0, 0, [UIntPtr]::Zero)

# Alt up
[SpikeInput]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)

Start-Sleep -Milliseconds 150
[SpikeInput]::SetCursorPos($origin.X, $origin.Y)
