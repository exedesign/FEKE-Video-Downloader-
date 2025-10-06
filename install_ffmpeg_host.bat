@echo off
setlocal

echo MGX MediaDownloader - FFmpeg Native Host Kurulumu
echo ===================================================

REM Mevcut dizini al
set "CURRENT_DIR=%~dp0"

REM Python kontrolü
python --version >nul 2>&1
if errorlevel 1 (
    echo HATA: Python bulunamadi! Python 3.6+ gereklidir.
    echo Python'u https://python.org adresinden indirin.
    pause
    exit /b 1
)

REM FFmpeg kontrolü
if exist "%CURRENT_DIR%ffmpeg.exe" (
    echo FFmpeg bulundu: %CURRENT_DIR%ffmpeg.exe
) else (
    echo UYARI: ffmpeg.exe bulunamadi!
    echo FFmpeg'i https://ffmpeg.org adresinden indirip bu klasore ekleyin.
    echo.
)

REM Native messaging host manifest dosyasının yolunu ayarla
set "MANIFEST_PATH=%CURRENT_DIR%com.mgx.mediadownloader.ffmpeg.json"
set "HOST_PATH=%CURRENT_DIR%ffmpeg_host.py"

REM Manifest dosyasında Python script yolunu güncelle
(
echo {
echo   "name": "com.mgx.mediadownloader.ffmpeg",
echo   "description": "MGX MediaDownloader FFmpeg Native Host",
echo   "path": "%HOST_PATH%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://*/*"
echo   ]
echo }
) > "%MANIFEST_PATH%"

REM Registry'ye native messaging host'u kaydet
echo Native messaging host registry'ye kaydediliyor...

reg add "HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.mgx.mediadownloader.ffmpeg" /ve /t REG_SZ /d "%MANIFEST_PATH%" /f >nul 2>&1

if errorlevel 1 (
    echo HATA: Registry kaydı başarısız!
    pause
    exit /b 1
)

echo.
echo ✓ Native messaging host başarıyla kuruldu!
echo ✓ Registry kaydı: HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.mgx.mediadownloader.ffmpeg
echo ✓ Manifest dosyası: %MANIFEST_PATH%
echo ✓ Host script: %HOST_PATH%
echo.

if not exist "%CURRENT_DIR%ffmpeg.exe" (
    echo HATIRLATMA: FFmpeg indirmeyi unutmayın!
    echo https://ffmpeg.org/download.html#build-windows
    echo.
)

echo Kurulum tamamlandı. Chrome'u yeniden başlatın.
pause