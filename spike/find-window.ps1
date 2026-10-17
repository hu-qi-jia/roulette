Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class WindowProbe {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindow(string className, string windowName);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@

function Show-Window([IntPtr]$handle) {
  $title = New-Object System.Text.StringBuilder 256
  [WindowProbe]::GetWindowText($handle, $title, 256) | Out-Null
  $processId = [uint32]0
  [WindowProbe]::GetWindowThreadProcessId($handle, [ref]$processId) | Out-Null
  '0x{0:X} title="{1}" pid={2}' -f $handle.ToInt64(), $title.ToString(), $processId
}

$target = [WindowProbe]::FindWindow($null, 'Roulette Insert Target')
$foreground = [WindowProbe]::GetForegroundWindow()

"target:     $(Show-Window $target)"
"foreground: $(Show-Window $foreground)"
