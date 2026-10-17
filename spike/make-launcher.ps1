$spike = $PSScriptRoot
$root = Split-Path $spike -Parent
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut('C:\Users\Public\roulette-launch.lnk')
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$spike\launch-app.ps1`""
$shortcut.WorkingDirectory = $root
$shortcut.Save()
Write-Output $shortcut.FullName
