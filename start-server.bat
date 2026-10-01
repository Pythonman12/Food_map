@echo off
chcp 65001 > nul
echo ===================================================
echo   부산 상가 업종 지도 (web2) 로컬 웹서버 실행기
echo ===================================================
echo.
echo URL: http://localhost:8081/
echo.
echo 브라우저 창을 열고 웹 서버를 시작합니다.
echo 서버를 종료하려면 이 창에서 Ctrl+C를 누르세요.
echo.

start "" "http://localhost:8081/"
python -m http.server 8081
if %errorlevel% neq 0 (
    uv run python -m http.server 8081
)
pause
