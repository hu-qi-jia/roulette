$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$env:ROULETTE_BASE_URL = 'http://127.0.0.1:8787/v1'
$env:ROULETTE_API_KEY = 'test'
$env:ROULETTE_TEXT_MODEL = 'mock'
$env:ROULETTE_CAPTURE = '1'
$env:ROULETTE_TEST_MESSAGE = 'hello'
$env:ROULETTE_TEST_INSERT = '1'
$env:ROULETTE_TEST_SIDEKEY = '1'

npm run dev *> (Join-Path $root 'out\app-launch.log')
