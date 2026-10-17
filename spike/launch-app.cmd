@echo off
cd /d "E:\新 个人项目\roulette"
set ROULETTE_BASE_URL=http://127.0.0.1:8787/v1
set ROULETTE_API_KEY=test
set ROULETTE_TEXT_MODEL=mock
set ROULETTE_CAPTURE=1
set ROULETTE_TEST_MESSAGE=hello
set ROULETTE_TEST_INSERT=1
set ROULETTE_TEST_SIDEKEY=1
if not exist out mkdir out
call npm run dev > out\app-launch.log 2>&1
