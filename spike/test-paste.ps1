# Regression check for the original insert-at-cursor path: the hook activates
# a known window and pastes into its focused edit control (no drop point).
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$hookExe = Join-Path $root 'native\mouse-hook\target\release\roulette-hook.exe'
$output = Join-Path $root 'out\paste-target.txt'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Roulette Paste Target'
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
$form.Add_Activated({ $box.Focus() })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({
  Set-Content -Path $output -Value "focused=$($box.Focused);text=[$($box.Text)]" -Encoding UTF8

  if (-not $script:sent -and (Get-Date) -gt $script:sendAt) {
    $script:sent = $true
    Set-Clipboard -Value 'paste-test'

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $hookExe
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $script:proc = [System.Diagnostics.Process]::Start($psi)
    Start-Sleep -Milliseconds 300
    $script:proc.StandardInput.WriteLine("paste $($form.Handle.ToInt64())")
    $script:proc.StandardInput.Flush()
  }

  if ($script:sent -and -not $script:proc.HasExited -and $box.Text -match 'paste-test') {
    $script:proc.Kill()
    $timer.Stop()
  }
})

$script:sendAt = (Get-Date).AddSeconds(1.5)
$timer.Start()
[System.Windows.Forms.Application]::Run($form)
