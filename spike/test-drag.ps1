# End-to-end drag-to-paste check.
# A WinForms text box sits left of the panel; a real left-button drag starts on
# the newest answer and releases inside the text box. The app is expected to
# paste the answer at the drop point via the native helper.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class DragMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@

$root = Split-Path $PSScriptRoot -Parent
$targetJson = Join-Path $root 'out\drag-test.json'
$resultFile = Join-Path $root 'out\drag-result.txt'
$stateFile = Join-Path $root 'out\drag-target.txt'
Remove-Item $targetJson, $resultFile -ErrorAction SilentlyContinue

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Roulette Drag Target'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(40, 120)
$form.Size = New-Object System.Drawing.Size(600, 300)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.Dock = 'Fill'
$box.ScrollBars = 'Vertical'
$box.Font = New-Object System.Drawing.Font('Consolas', 12)
$form.Controls.Add($box)
$form.Add_Shown({
  $form.Activate()
  $box.Focus()
})
$form.Add_Activated({ $box.Focus() })

function Invoke-Drag([int]$x0, [int]$y0, [int]$x1, [int]$y1, [switch]$EscapeBeforeRelease) {
  [DragMouse]::SetCursorPos($x0, $y0) | Out-Null
  Start-Sleep -Milliseconds 150
  [DragMouse]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120

  # Cross the drag threshold while still on the panel.
  [DragMouse]::SetCursorPos($x0 + 16, $y0 + 8) | Out-Null
  Start-Sleep -Milliseconds 80

  for ($i = 1; $i -le 14; $i++) {
    $x = [int]($x0 + (($x1 - $x0) * $i / 14))
    $y = [int]($y0 + (($y1 - $y0) * $i / 14))
    [DragMouse]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 22
  }
  [DragMouse]::SetCursorPos($x1, $y1) | Out-Null
  Start-Sleep -Milliseconds 100

  if ($EscapeBeforeRelease) {
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    Start-Sleep -Milliseconds 150
  }

  [DragMouse]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-Selection([int]$x0, [int]$y0, [int]$x1, [int]$y1) {
  [DragMouse]::SetCursorPos($x0, $y0) | Out-Null
  Start-Sleep -Milliseconds 120
  [DragMouse]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  for ($i = 1; $i -le 10; $i++) {
    $x = [int]($x0 + (($x1 - $x0) * $i / 10))
    [DragMouse]::SetCursorPos($x, $y1) | Out-Null
    Start-Sleep -Milliseconds 30
  }
  [DragMouse]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

function Copy-Selection {
  [DragMouse]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [DragMouse]::keybd_event(0x43, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [DragMouse]::keybd_event(0x43, 0, 2, [UIntPtr]::Zero)
  [DragMouse]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 250
}

function Start-Drag {
  if ($script:dragging) { return }
  if (-not (Test-Path $targetJson)) { return }
  $script:dragging = $true
  try {
    $target = Get-Content $targetJson -Raw | ConvertFrom-Json
    $panelX = [int]$target.panel.x
    $dragX = [int]$target.handle.x
    $dragY = [int]$target.handle.y
    # Keep the drop point just left of the panel and inside the form.
    $form.Width = [Math]::Max(420, $panelX - 80)
    $dropX = [Math]::Max(60, $panelX - 100)
    $dropY = 260
    Set-Content -Path $stateFile -Value "handle=$dragX,$dragY drop=$dropX,$dropY" -Encoding UTF8

    # Dragging across the answer text must select it (not start a paste drag).
    Set-Clipboard -Value 'clipboard-sentinel'
    Invoke-Selection ([int]$target.text.x) ([int]$target.text.y) ([int]$target.textEnd.x) ([int]$target.text.y)
    Copy-Selection
    $selection = Get-Clipboard -Raw
    if (-not $selection -or $selection -notmatch 'Mock|reply') {
      Set-Content -Path $resultFile -Value "FAIL selection text=[$selection]" -Encoding UTF8
      $script:done = $true
      $timer.Stop()
      return
    }

    # First paste drag: Escape cancels it, so nothing may be pasted.
    Invoke-Drag $dragX $dragY $dropX $dropY -EscapeBeforeRelease
    Start-Sleep -Milliseconds 900
    if ($box.Text -ne '') {
      Set-Content -Path $resultFile -Value "FAIL escape-cancel text=[$($box.Text)]" -Encoding UTF8
      $script:done = $true
      $timer.Stop()
      return
    }

    # Second paste drag: release over the text box pastes there.
    Invoke-Drag $dragX $dragY $dropX $dropY
    $script:releasedAt = Get-Date
  } catch {
    Set-Content -Path $resultFile -Value "ERROR $_" -Encoding UTF8
    $script:done = $true
    $timer.Stop()
  }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 120
$timer.Add_Tick({
  Set-Content -Path $stateFile -Value "focused=$($box.Focused);text=[$($box.Text)]" -Encoding UTF8

  if (-not $script:dragging) {
    if ((Test-Path $targetJson) -and ((Get-Date) -gt $script:startAt.AddSeconds(2))) {
      Start-Drag
    }
    return
  }

  if ($script:releasedAt -and -not $script:done) {
    if ($box.Text -match 'Mock reply') {
      $script:done = $true
      $elapsed = [int]((Get-Date) - $script:releasedAt).TotalMilliseconds
      Set-Content -Path $resultFile -Value "PASS paste_ms=$elapsed escape_cancel=ok selection_ok text=[$($box.Text)]" -Encoding UTF8
      $timer.Stop()
    } elseif (((Get-Date) - $script:releasedAt).TotalSeconds -gt 6) {
      $script:done = $true
      Set-Content -Path $resultFile -Value "FAIL timeout text=[$($box.Text)]" -Encoding UTF8
      $timer.Stop()
    }
  }
})

$script:startAt = Get-Date
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
