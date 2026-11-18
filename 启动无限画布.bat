@echo off
setlocal EnableExtensions
title Infinite Canvas

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "WEB=%ROOT%\web"
set "DAV=%ROOT%\WebDAV"
set "STORE=%ROOT%\store-server"
set "BUN=O:\AI\.bun\bin\bun.exe"
if not exist "%BUN%" (
    where bun >nul 2>nul
    if errorlevel 1 (
        echo [!] bun.exe not found: O:\AI\.bun\bin\bun.exe
        pause
        exit /b 1
    )
    set "BUN=bun"
)

if not exist "%WEB%\node_modules" (
    echo [!] node_modules missing. Run this once first:
    echo     cd /d "%WEB%" ^&^& "%BUN%" install
    pause
    exit /b 1
)

echo ==========================================
echo   Infinite Canvas
echo   storage  http://127.0.0.1:9410
echo   webdav   http://127.0.0.1:5000
echo   proxy    http://127.0.0.1:23210
echo   agent    http://127.0.0.1:17371
echo   web      http://localhost:3000
echo ==========================================
echo.

set "START_DAV="
set "START_AGENT="
set "DAV_ANSWER="
set /p "DAV_ANSWER=Start WebDAV (dufs)? [Enter = skip / y = start]: "
if /i "%DAV_ANSWER%"=="y" set "START_DAV=1"
set "AGENT_ANSWER="
set /p "AGENT_ANSWER=Start canvas-agent? [Enter = skip / y = start]: "
if /i "%AGENT_ANSWER%"=="y" set "START_AGENT=1"
echo.

set "WEB_UP="
set "PROXY_UP="
set "DAV_UP="
set "STORE_UP="
set "AGENT_UP="
for /f "delims=" %%L in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do set "WEB_UP=1"
for /f "delims=" %%L in ('netstat -ano ^| findstr /R /C:":23210 .*LISTENING"') do set "PROXY_UP=1"
for /f "delims=" %%L in ('netstat -ano ^| findstr /R /C:":5000 .*LISTENING"') do set "DAV_UP=1"
for /f "delims=" %%L in ('netstat -ano ^| findstr /R /C:":9410 .*LISTENING"') do set "STORE_UP=1"
for /f "delims=" %%L in ('netstat -ano ^| findstr /R /C:":17371 .*LISTENING"') do set "AGENT_UP=1"

if defined STORE_UP (
    echo [1/5] storage  already on 9410 - skipped
) else (
    if exist "%STORE%\index.ts" (
        echo [1/5] storage  starting store-server on 9410 ...
        start "ic-store" /b /D "%STORE%" "%BUN%" index.ts
        ping -n 3 127.0.0.1 >nul
    ) else (
        echo [1/5] storage  store-server\index.ts missing - skipped
    )
)

if defined DAV_UP goto dav_running
if not defined START_DAV goto dav_skipped
if not exist "%DAV%\dufs.exe" goto dav_missing
echo [2/5] webdav   starting dufs on 5000 ...
start "ic-webdav" /b /D "%DAV%" "%DAV%\dufs.exe" data -b 127.0.0.1 -A
ping -n 3 127.0.0.1 >nul
set "DAV_RUNNING=1"
goto dav_done

:dav_running
echo [2/5] webdav   already on 5000 - skipped
set "DAV_RUNNING=1"
goto dav_done

:dav_missing
echo [2/5] webdav   dufs.exe missing - skipped
goto dav_done

:dav_skipped
echo [2/5] webdav   skipped - press D after startup to start it
:dav_done

if defined PROXY_UP (
    echo [3/5] proxy    already on 23210 - skipped
) else (
    echo [3/5] proxy    starting local proxy on 23210 ...
    start "ic-proxy" /b /D "%ROOT%" "%BUN%" canvas-proxy\index.js
    ping -n 3 127.0.0.1 >nul
)

if defined AGENT_UP goto agent_running
if not defined START_AGENT goto agent_skipped
echo [4/5] agent    starting canvas-agent on 17371 ...
start "ic-agent" /b /D "%ROOT%" "%BUN%" x @basketikun/canvas-agent@latest
ping -n 8 127.0.0.1 >nul
set "AGENT_RUNNING=1"
call :show_token
goto agent_done

:agent_running
echo [4/5] agent    already on 17371 - skipped
set "AGENT_RUNNING=1"
call :show_token
goto agent_done

:agent_skipped
echo [4/5] agent    skipped - press A after startup to start it
:agent_done

if defined WEB_UP (
    echo [5/5] web      already on 3000 - skipped
) else (
    echo [5/5] web      starting vite dev server on 3000 ...
    start "ic-web" /b /D "%WEB%" "%BUN%" run dev
)

echo.
set /a tries=0
:waitweb
"%SystemRoot%\System32\curl.exe" -s -f --max-time 2 -o nul http://localhost:3000/ >nul 2>nul
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% GEQ 45 goto waittimeout
ping -n 2 127.0.0.1 >nul
goto waitweb

:waittimeout
echo [!] web not responding after 45s. Open http://localhost:3000 manually.
goto running

:ready
echo [ok] web is ready - opening browser.
start "" http://localhost:3000

:running
echo.
echo ==========================================
echo   Q + Enter  -^> stop all services and close
if not defined DAV_RUNNING echo   D + Enter  -^> start WebDAV (dufs)
if not defined AGENT_RUNNING echo   A + Enter  -^> start canvas-agent
echo   Enter only -^> keep running
echo ==========================================
set /a idle=0
set "HINT=Q=stop"
if not defined DAV_RUNNING set "HINT=%HINT%  D=WebDAV"
if not defined AGENT_RUNNING set "HINT=%HINT%  A=agent"
set "HINT=%HINT%  Enter=keep"
:wait_cmd
set "ACTION="
set /p "ACTION=%HINT%: "
if /i "%ACTION%"=="q" goto shutdown
if /i "%ACTION%"=="d" goto start_dav_later
if /i "%ACTION%"=="a" goto start_agent_later
set /a idle+=1
if %idle% GEQ 100 goto auto_exit
goto wait_cmd

:start_dav_later
if defined DAV_RUNNING goto running
if not exist "%DAV%\dufs.exe" goto start_dav_missing
echo.
echo Starting WebDAV on 5000 ...
start "ic-webdav" /b /D "%DAV%" "%DAV%\dufs.exe" data -b 127.0.0.1 -A
ping -n 3 127.0.0.1 >nul
set "DAV_RUNNING=1"
goto running

:start_dav_missing
echo.
echo [!] dufs.exe not found - cannot start WebDAV.
goto wait_cmd

:start_agent_later
if defined AGENT_RUNNING goto running
echo.
echo Starting canvas-agent on 17371 ...
start "ic-agent" /b /D "%ROOT%" "%BUN%" x @basketikun/canvas-agent@latest
ping -n 8 127.0.0.1 >nul
set "AGENT_RUNNING=1"
call :show_token
goto running

:show_token
set "AGENT_TOKEN="
for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "Get-Content -Raw '%USERPROFILE%\.infinite-canvas\canvas-agent.json' | ConvertFrom-Json | Select-Object -ExpandProperty token" 2^>nul`) do set "AGENT_TOKEN=%%T"
if defined AGENT_TOKEN (
    echo           token: %AGENT_TOKEN%
) else (
    echo           token: see %USERPROFILE%\.infinite-canvas\canvas-agent.json
)
goto :eof

:auto_exit
echo.
echo No input detected - stopping services and exiting.
goto shutdown

:shutdown
echo.
echo Stopping services ...
for %%P in (3000 23210 5000 9410 17371) do (
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
        taskkill /PID %%I /F >nul 2>nul
    )
)
ping -n 3 127.0.0.1 >nul
echo Done. All services stopped.
ping -n 3 127.0.0.1 >nul
exit /b 0
