Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public struct RECT { public int L, T, R, B; }
}
"@

$windows = New-Object System.Collections.ArrayList
$callback = [WinEnum+EnumProc]{
  param($h, $l)
  if ([WinEnum]::IsWindowVisible($h)) {
    $title = New-Object System.Text.StringBuilder 256
    [WinEnum]::GetWindowText($h, $title, 256) | Out-Null
    if ($title.ToString() -eq 'Roulette') {
      $rect = New-Object WinEnum+RECT
      [WinEnum]::GetWindowRect($h, [ref]$rect) | Out-Null
      $pidValue = 0
      [WinEnum]::GetWindowThreadProcessId($h, [ref]$pidValue) | Out-Null
      [void]$windows.Add(("{0} {1},{2} {3}x{4} pid={5}" -f $h, $rect.L, $rect.T, ($rect.R - $rect.L), ($rect.B - $rect.T), $pidValue))
    }
  }
  return $true
}
[WinEnum]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
$windows
