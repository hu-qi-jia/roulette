Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Roulette Insert Target'
$form.Width = 560
$form.Height = 240
$form.StartPosition = 'CenterScreen'

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.Dock = 'Fill'
$box.ScrollBars = 'Vertical'
$box.Font = New-Object System.Drawing.Font('Consolas', 12)
$form.Controls.Add($box)

$output = Join-Path (Split-Path $PSScriptRoot -Parent) 'out\insert-target.txt'

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 300
$timer.Add_Tick({
  $state = "focused=$($box.Focused);active=$($form.ActiveControl -eq $box);text=[$($box.Text)]"
  Set-Content -Path $output -Value $state -Encoding UTF8
})
$timer.Start()

$form.Add_Shown({
  $form.Activate()
  $box.Focus()
})

# Re-focus the text box whenever the form is re-activated (e.g. after the
# roulette panel hides and focus returns to this window).
$form.Add_Activated({
  $box.Focus()
})

[System.Windows.Forms.Application]::Run($form)
