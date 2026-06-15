@echo off
echo Stopping Legado Source Validator on port 1111...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :1111 ^| findstr LISTENING') do (
    echo Found PID: %%a
    taskkill /PID %%a /F
    if %errorlevel%==0 (
        echo Stopped successfully.
    ) else (
        echo Failed to stop. Try running as administrator.
    )
    goto :done
)
echo No validator found running on port 1111.
:done
pause
