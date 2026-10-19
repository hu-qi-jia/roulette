# Drag-to-paste against a Chromium textarea that is NOT the foreground window.
# Verifies that the drop activates the target by itself (no preparatory click).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class HtmlDrag {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@

$root = Split-Path $PSScriptRoot -Parent
$targetJson = Join-Path $root 'out\drag-test.json'
$targetText = Join-Path $root 'out\html-target.txt'
$resultFile = Join-Path $root 'out\drag-html-result.txt'
Remove-Item $resultFile -ErrorAction SilentlyContinue

$deadline = (Get-Date).AddSeconds(25)
while (-not (Test-Path $targetJson) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 200
}
if (-not (Test-Path $targetJson)) {
  Set-Content -Path $resultFile -Value 'FAIL no drag target json' -Encoding UTF8
  exit 1
}

$target = Get-Content $targetJson -Raw | ConvertFrom-Json
$startX = [int]$target.handle.x
$startY = [int]$target.handle.y
$dropX = 650
$dropY = 260

[HtmlDrag]::SetCursorPos($startX, $startY) | Out-Null
Start-Sleep -Milliseconds 300
[HtmlDrag]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
[HtmlDrag]::SetCursorPos($startX + 16, $startY + 8) | Out-Null
Start-Sleep -Milliseconds 90
for ($i = 1; $i -le 14; $i++) {
  $x = [int]($startX + (($dropX - $startX) * $i / 14))
  $y = [int]($startY + (($dropY - $startY) * $i / 14))
  [HtmlDrag]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 22
}
[HtmlDrag]::SetCursorPos($dropX, $dropY) | Out-Null
Start-Sleep -Milliseconds 120
$releasedAt = Get-Date
[HtmlDrag]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)

$text = ''
$active = ''
$events = @()
$deadline = (Get-Date).AddSeconds(8)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 100
  if (Test-Path $targetText) {
    try {
      $state = Get-Content $targetText -Raw | ConvertFrom-Json
      $text = [string]$state.value
      $active = [string]$state.active
      $events = @($state.events)
    } catch {
      continue
    }
    if ($text -match 'Mock reply' -or $text -match 'drag test') {
      $elapsed = [int]((Get-Date) - $releasedAt).TotalMilliseconds
      Set-Content -Path $resultFile -Value "PASS paste_ms=$elapsed text=[$text]" -Encoding UTF8
      exit 0
    }
  }
}
Set-Content -Path $resultFile -Value "FAIL active=[$active] events=[$($events -join ',')] text=[$text]" -Encoding UTF8
exit 1
