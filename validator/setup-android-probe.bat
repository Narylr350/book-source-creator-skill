@echo off
REM setup-android-probe.bat - Install and start Android Probe on connected device
REM Usage: setup-android-probe.bat [apk-path]

setlocal

set APK=%~1
if "%APK%"=="" set APK=%~dp0android-probe.apk
if not exist "%APK%" (
    if exist "%~dp0..\android-probe\app\build\outputs\apk\debug\app-debug.apk" (
        set APK=%~dp0..\android-probe\app\build\outputs\apk\debug\app-debug.apk
    )
)

if not exist "%APK%" (
    echo ERROR: APK not found at %APK%
    echo Please build: android-probe\gradlew.bat assembleDebug
    exit /b 1
)

echo Checking adb...
set "LOCAL_ADB=%~dp0tools\platform-tools\adb.exe"
set "ADB=%LOCAL_ADB%"
if exist "%LOCAL_ADB%" (
    goto :adb_ready
)

set ADB=adb
adb version >nul 2>&1
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
    ) else (
        echo adb not found. Installing Android SDK Platform-Tools locally...
        call "%~dp0setup-adb.bat"
        if errorlevel 1 exit /b 1
        if not exist "%LOCAL_ADB%" (
            echo ERROR: adb install completed but adb.exe was not found.
            exit /b 1
        )
        set "ADB=%LOCAL_ADB%"
    )
)

:adb_ready
echo Checking devices...
for /f "skip=1 tokens=1,2" %%a in ('"%ADB%" devices') do (
    if "%%b"=="device" (
        echo Found device: %%a
        echo Installing APK...
        "%ADB%" -s %%a install -r "%APK%"
        if errorlevel 1 (
            echo ERROR: Install failed
            exit /b 1
        )
        echo Starting Probe...
        "%ADB%" -s %%a shell am start -n io.legado.probe/.WebViewProbeActivity
        echo Setting up port forward...
        "%ADB%" -s %%a forward tcp:18888 tcp:18888
        echo Waiting for Probe...
        timeout /t 3 /nobreak >nul
        curl -s --max-time 5 http://127.0.0.1:18888/ping >nul 2>nul
        if errorlevel 1 (
            echo ERROR: Probe did not respond on localhost:18888
            exit /b 1
        )
        echo Clearing Probe WebView cookies...
        curl -s --max-time 5 -X POST http://127.0.0.1:18888/cookie-clear >nul 2>nul
        if errorlevel 1 (
            echo ERROR: Failed to clear Probe WebView cookies
            exit /b 1
        )
        echo.
        echo Android Probe is running on device %%a
        echo Port forward: localhost:18888 ^> device:18888
        echo.
        echo To stop: "%ADB%" -s %%a shell am force-stop io.legado.probe
        goto :done
    )
)

echo ERROR: No Android devices connected
exit /b 1

:done
endlocal
