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
set ADB=adb
adb version >nul 2>&1
if errorlevel 1 (
    if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" (
        set ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
    ) else (
        echo ERROR: adb not found in PATH
        echo Please install Android SDK Platform Tools
        exit /b 1
    )
)

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
