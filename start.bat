@echo off
chcp 65001 >nul
title 专注时光 - 桌面应用
echo.
echo   正在启动「专注时光」桌面应用...
echo   账号1: 13800000001  密码: 123456
echo   账号2: 13900000002  密码: 123456
echo.
cd /d "%~dp0"
start "" npx electron .
