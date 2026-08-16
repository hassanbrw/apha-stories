@echo off
REM Faceless Studio — Windows shuruaat
cd /d "%~dp0"
echo.
echo ============================================================
echo   FACELESS STUDIO
echo ============================================================
echo.
echo   Claude khol raha hun. Jab khul jaye to likhna:
echo.
echo       START-HERE.md parho aur mujhe set up karo
echo.
echo ============================================================
echo.
where claude >nul 2>nul
if %errorlevel%==0 ( claude ) else ( echo   [X] "claude" nahi mila. Pehle Claude Code install karo. & pause )
