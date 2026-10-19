param([int]$X = 1090, [int]$Y = 300)
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinAt {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
}
"@
$point = New-Object WinAt+POINT
$point.X = $X
$point.Y = $Y
$h = [WinAt]::WindowFromPoint($point)
$root = [WinAt]::GetAncestor($h, 2)
foreach ($candidate in @($h, $root)) {
  $title = New-Object System.Text.StringBuilder 256
  $class = New-Object System.Text.StringBuilder 256
  [WinAt]::GetWindowText($candidate, $title, 256) | Out-Null
  [WinAt]::GetClassName($candidate, $class, 256) | Out-Null
  $rect = New-Object WinAt+RECT
  [WinAt]::GetWindowRect($candidate, [ref]$rect) | Out-Null
  $pidValue = 0
  [WinAt]::GetWindowThreadProcessId($candidate, [ref]$pidValue) | Out-Null
  Write-Output ("{0} class={1} title={2} rect={3},{4} {5}x{6} pid={7}" -f $candidate, $class, $title, $rect.L, $rect.T, ($rect.R - $rect.L), ($rect.B - $rect.T), $pidValue)
}
