@echo off
chcp 65001 >nul
title 郅绘ai画布 - 积分码生成器
cd /d "%~dp0"
if exist "node_modules\.bin\electron.cmd" (
  call node_modules\.bin\electron.cmd tools\recharge-code-generator-ui.cjs
) else (
  npm.cmd run recharge:generator
)
