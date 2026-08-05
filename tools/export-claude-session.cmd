@echo off
node "%~dp0export-claude-session.mjs" %*
exit /b %ERRORLEVEL%
