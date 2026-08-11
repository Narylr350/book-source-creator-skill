@echo off
setlocal
cd /d "%~dp0"
set "BSG=..\scripts\bsg.mjs"
if not exist "%BSG%" set "BSG=..\legado-book-source-generator\scripts\bsg.mjs"
node "%BSG%" validator-start
endlocal
