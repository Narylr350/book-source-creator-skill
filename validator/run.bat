@echo off
title Legado Source Validator - http://localhost:1111
cd /d "%~dp0"
echo ========================================
echo   Legado Source Validator
echo   http://localhost:1111
echo   Press Ctrl+C to stop
echo ========================================
java -jar app\legado-source-validator.jar
