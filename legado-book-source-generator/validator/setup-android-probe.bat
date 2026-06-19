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
set DEVICE=
for /f "skip=1 tokens=1,2" %%a in ('"%ADB%" devices') do (
    if "%%b"=="device" (
        if not defined DEVICE set DEVICE=%%a
    )
)

if not defined DEVICE (
    echo ERROR: No Android devices connected
    exit /b 1
)

echo Found device: %DEVICE%
echo Clearing old port forward...
"%ADB%" -s %DEVICE% forward --remove tcp:18888 >nul 2>&1
echo Installing APK...
"%ADB%" -s %DEVICE% install -r "%APK%"
if errorlevel 1 (
    echo ERROR: Install failed
    exit /b 1
)
echo Starting Probe...
"%ADB%" -s %DEVICE% shell am start -n io.legado.probe/.WebViewProbeActivity
echo Setting up port forward...
"%ADB%" -s %DEVICE% forward tcp:18888 tcp:18888
if errorlevel 1 (
    echo ERROR: Port forward failed
    exit /b 1
)
echo Waiting for Probe /ping...
for /l %%i in (1,1,20) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:18888/ping' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
    if not errorlevel 1 goto :ready
    timeout /t 1 /nobreak >nul
)
echo ERROR: Probe did not respond on http://127.0.0.1:18888/ping
echo Try unlocking the phone, then run this script again. Do not manually adb install the APK.
exit /b 1

:ready
echo.
echo Android Probe is running on device %DEVICE%
echo Port forward: localhost:18888 ^> device:18888
echo Probe check: http://127.0.0.1:18888/ping OK
echo.
echo To stop: "%ADB%" -s %DEVICE% shell am force-stop io.legado.probe

:done
endlocal
