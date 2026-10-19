# Verifies the native drop-at-point path without Electron:
# a WinForms text box waits at a known location, the hook resolves the window
# under the drop point, clicks there, and pastes the clipboard.
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$hookExe = Join-Path $root 'native\mouse-hook\target\release\roulette-hook.exe'
$output = Join-Path $root 'out\drop-target.txt'
$dropX = 420
$dropY = 320

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Roulette Drop Target'
$form.StartPosition = 'Manual'
$form.Location = New-Object System.Drawing.Point(200, 200)
$form.Size = New-Object System.Drawing.Size(560, 240)

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
$form.Add_Activated({
  $box.Focus()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
  $state = "focused=$($box.Focused);text=[$($box.Text)]"
  Set-Content -Path $output -Value $state -Encoding UTF8

  if (-not $script:dropped -and (Get-Date) -gt $script:dropAt) {
    $script:dropped = $true
    Set-Clipboard -Value 'drop-at-test'

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $hookExe
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $script:proc = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Milliseconds 300
    $script:proc.StandardInput.WriteLine("dropat $dropX $dropY")
    $script:proc.StandardInput.Flush()
    $script:droppedAt = Get-Date
  }

  if ($script:dropped -and -not $script:proc.HasExited -and ((Get-Date) -gt $script:droppedAt.AddSeconds(4))) {
    $script:proc.Kill()
  }
})

$script:dropAt = (Get-Date).AddSeconds(2)
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
