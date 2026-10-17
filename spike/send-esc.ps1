# Test helper: send a single Escape key press.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class KeyInput {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint f, UIntPtr e);
}
"@

[KeyInput]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[KeyInput]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
Write-Output 'escape sent'
