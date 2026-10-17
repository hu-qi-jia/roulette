param(
  [string]$Text = "hello",
  [string]$Title = "Roulette"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

Start-Sleep -Milliseconds 400

try {
  [Microsoft.VisualBasic.Interaction]::AppActivate($Title) | Out-Null
  Write-Output "activated: $Title"
} catch {
  Write-Warning "activate failed: $_"
}

Start-Sleep -Milliseconds 900
[System.Windows.Forms.SendKeys]::SendWait($Text)
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
