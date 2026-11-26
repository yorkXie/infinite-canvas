@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul
title Infinite Canvas 1.0
pushd "%~dp0" || exit /b 1

where.exe node.exe >nul 2>&1 || goto :need_node
node.exe -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" || goto :need_node

set "IC_PNPM=pnpm"
where.exe pnpm >nul 2>&1
if errorlevel 1 (
    where.exe npx.cmd >nul 2>&1 || goto :need_pnpm
    set "IC_PNPM=npx.cmd --prefer-offline --yes --package=pnpm@12.6.0 -- pnpm"
)
if not exist "apps\cli\node_modules\tsx\package.json" goto :need_deps

echo 正在启动无限画布 1.0…
call %IC_PNPM% --dir apps/cli exec node --import tsx src/dev.ts serve --open --quit-on-q %*
set "IC_EXIT=%errorlevel%"
if not "%IC_EXIT%"=="0" pause
popd
exit /b %IC_EXIT%

:need_node
echo 请安装 Node.js 22 或更高版本，再双击此脚本。
goto :failed

:need_pnpm
echo 请安装 pnpm 12.6.0，或安装自带 npx 的 Node.js，再双击此脚本。
goto :failed

:need_deps
echo 请在本项目根目录运行以下命令安装依赖，然后重新双击此脚本。
echo   %IC_PNPM% install --frozen-lockfile
:failed
pause
popd
exit /b 1
