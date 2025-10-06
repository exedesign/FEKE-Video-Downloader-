# MGX Media Downloader - FFmpeg Kurulum Kılavuzu

## 🎯 FFmpeg Özelliği Nedir?

FFmpeg özelliği, HLS stream'lerindeki TS segmentlerini **profesyonel kalitede** birleştirmenizi sağlar. Normal tarayıcı birleştirmesinden çok daha güvenilir ve kalitelidir.

## 📋 Gereksinimler

1. **Python 3.6+** - [python.org](https://python.org) adresinden indirin
2. **FFmpeg Binary** - [ffmpeg.org](https://ffmpeg.org/download.html#build-windows) adresinden indirin
3. **Chrome/Edge** tarayıcı

## 🔧 Kurulum Adımları

### Adım 1: Python Kurulumu
```bash
# Python versiyonunu kontrol edin
python --version
```

### Adım 2: FFmpeg Binary İndirme
1. [FFmpeg Windows Builds](https://www.gyan.dev/ffmpeg/builds/) sayfasına gidin
2. "release builds" → "ffmpeg-release-essentials.zip" indirin
3. ZIP'i açın ve `ffmpeg.exe` dosyasını extension klasörüne kopyalayın

### Adım 3: Native Host Kurulumu
1. Extension klasöründeki `install_ffmpeg_host.bat` dosyasını **yönetici olarak** çalıştırın
2. Script otomatik olarak:
   - Native messaging host'u registry'ye kaydeder
   - Gerekli izinleri ayarlar
   - FFmpeg varlığını kontrol eder

### Adım 4: Chrome'u Yeniden Başlatın
Extension'ı yeniden yükleyin veya Chrome'u tamamen kapatıp açın.

## 🎬 Kullanım

1. **HLS Stream Tespit**: Extension otomatik olarak M3U8 dosyalarını yakalar
2. **FFmpeg Butonu**: Popup'ta "FFmpeg" butonuna tıklayın
3. **Otomatik İşlem**: 
   - Tüm TS segmentleri indirilir
   - FFmpeg ile birleştirilir
   - Downloads klasörüne kaydedilir

## 🔍 Sorun Giderme

### "FFmpeg Gerekli" Hatası
- `ffmpeg.exe` dosyasının extension klasöründe olduğunu kontrol edin
- `install_ffmpeg_host.bat` dosyasını yönetici olarak çalıştırın

### "Native Host Bağlanamadı" Hatası
```bash
# Registry kaydını kontrol edin
reg query "HKEY_CURRENT_USER\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.mgx.mediadownloader.ffmpeg"
```

### Python Hatası
- Python'un PATH'e eklendiğini kontrol edin
- Python 3.6+ versiyonu gereklidir

## 📁 Dosya Yapısı

```
MGX-MediaDownloader/
├── manifest.json
├── background.js
├── popup.html/js
├── content.js
├── ffmpeg_host.py                    # Native messaging host
├── install_ffmpeg_host.bat           # Kurulum script'i
├── com.mgx.mediadownloader.ffmpeg.json
└── ffmpeg.exe                        # İndirmeniz gereken dosya
```

## ⚡ FFmpeg vs Tarayıcı Birleştirme

| Özellik | Tarayıcı | FFmpeg |
|---------|----------|--------|
| Hız | ⚡ Hızlı | 🐌 Yavaş |
| Kalite | 📱 Orta | 🎬 Yüksek |
| Bellek | 🔥 Yüksek | 💚 Düşük |
| Segmentation | ❌ Sorunlu | ✅ Mükemmel |
| Audio Sync | ⚠️ Risk | ✅ Garantili |

## 🎯 Desteklenen Formatlar

- **Giriş**: M3U8, HLS streams
- **Çıkış**: MP4 (H.264 + AAC)
- **Segmentler**: TS dosyaları

## 📞 Destek

Sorun yaşıyorsanız:
1. Browser console'u kontrol edin (F12)
2. `install_ffmpeg_host.bat` dosyasını yeniden çalıştırın
3. Chrome'u tamamen yeniden başlatın

---
*MGX Media Downloader v1.1 - Gelişmiş HLS Processing*