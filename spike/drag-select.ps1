param(
  [int]$X1 = 300,
  [int]$Y1 = 200,
  [int]$X2 = 600,
  [int]$Y2 = 400
)

# Test helper: perform a left-button drag, used to select a screenshot region.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DragInput {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
}
"@

[DragInput]::SetCursorPos($X1, $Y1) | Out-Null
Start-Sleep -Milliseconds 200
[DragInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 150

$steps = 6
for ($i = 1; $i -le $steps; $i++) {
  $x = $X1 + [int](($X2 - $X1) * $i / $steps)
  $y = $Y1 + [int](($Y2 - $Y1) * $i / $steps)
  [DragInput]::mouse_event(0x0001, [int](($X2 - $X1) / $steps), [int](($Y2 - $Y1) / $steps), 0, [UIntPtr]::Zero)
  [DragInput]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 40
}

Start-Sleep -Milliseconds 250
[DragInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
Write-Output "dragged ($X1,$Y1) -> ($X2,$Y2)"
