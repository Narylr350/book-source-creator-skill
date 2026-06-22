@echo off
node "%~dp0export-opencode-session.mjs" %*
exit /b %ERRORLEVEL%
