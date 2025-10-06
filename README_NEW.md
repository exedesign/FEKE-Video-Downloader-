# 🎬 MGX MEDIA DOWNLOADER PRO
## Professional HLS Video Downloader

### ✨ YENİ ÖZELLIKLER

#### 🎯 Akıllı M3U8 Parser
- **3 Seviyeli Analiz Sistemi**
  1. **Master Playlist**: Çoklu kalite seçenekleri (1080p, 720p, 480p, vs.)
  2. **Variant Playlist**: Tek kalite TS segmentleri
  3. **Audio Playlist**: AAC audio segmentleri

#### 📊 Desteklenen Playlist Formatları

**1. Master Playlist (Çoklu Kalite)**
```m3u8
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p/variant_1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p/variant_720p.m3u8
```

**2. Variant Playlist (TS Segmentleri)**
```m3u8
#EXTM3U
#EXTINF:10.000000,
segment_0000.ts
#EXTINF:10.000000,
segment_0001.ts
```

**3. Audio Playlist (AAC Segmentleri)**
```m3u8
#EXTM3U
#EXTINF:10.004833,
segment_0000.aac
#EXTINF:10.005667,
segment_0001.aac
```

**4. Ayrı Audio/Video Tracks**
```m3u8
#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio0",URI="audio/tur/audio_tur.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=5000000,AUDIO="audio0"
1080p/variant_1080p.m3u8
```

### 🚀 Kullanım

1. **Chrome'da uzantıyı yükleyin**
   - `chrome://extensions/` sayfasını açın
   - "Developer mode" aktif edin
   - "Load unpacked" ile klasörü seçin

2. **Video streaming sitesine gidin**
   - Uzantı otomatik olarak M3U8 dosyalarını yakalar
   - Badge'de kaç tane medya bulunduğunu gösterir

3. **Popup'ı açın**
   - Yakalanan M3U8 dosyalarını görün
   - "🔍 Analiz Et" butonuna tıklayın

4. **Kalite seçin ve indirin**
   - Master playlist: İstediğiniz kaliteyi seçin
   - Variant playlist: Tarayıcıda veya FFmpeg ile indirin
   - Audio playlist: Audio dosyasını indirin

### 💡 İndirme Yöntemleri

#### 🌐 Tarayıcıda Birleştir
- Hızlı ve kolay
- Segmentleri JavaScript ile birleştirir
- .ts dosyası olarak kaydeder

#### ⚡ FFmpeg ile İndir
- Profesyonel kalite
- Ayrı audio/video track'leri birleştirir
- MP4 formatında kaydeder
- FFmpeg kurulumu gereklidir

### 🔧 FFmpeg Kurulumu (Opsiyonel)

1. `ffmpeg.exe` dosyasını extension klasörüne koyun
2. `install_ffmpeg_host.bat` dosyasını çalıştırın
3. Chrome'u yeniden başlatın

### 📋 Özellikler

✅ M3U8 playlist otomatik yakalama
✅ Master/Variant/Audio playlist analizi
✅ Çoklu kalite seçeneği
✅ Segment sayısı ve süre bilgisi
✅ Otomatik segment indirme
✅ Browser-based birleştirme
✅ FFmpeg entegrasyonu
✅ Ayrı audio/video track desteği
✅ Progress göstergesi
✅ Modern ve kullanıcı dostu UI

### 🎨 Yeni Arayüz

- **Gradient Tasarım**: Modern mor gradient arkaplan
- **M3U8 Özel Kartlar**: Pembe gradient ile vurgulanan M3U8 dosyaları
- **Kalite Badge'leri**: Her kalite için renkli badge
- **Progress Bar**: Gerçek zamanlı indirme göstergesi
- **Responsive**: Tüm bilgiler düzenli şekilde gösteriliyor

### 🛠️ Teknik Detaylar

**Background.js**
- WebRequest API ile M3U8 yakalama
- 3 seviyeli playlist parser
- FFmpeg native messaging
- Akıllı URL resolution

**Popup.js**
- Modern UI komponenleri
- Async playlist parsing
- Progress tracking
- FFmpeg integration

**Content.js**
- Browser-based segment download
- Batch downloading (5 concurrent)
- Blob merging
- Progress notification

### 📝 Notlar

- M3U8 dosyaları otomatik olarak yakalanır
- Popup her 3 saniyede bir güncellenir
- Segment indirme işlemi background'da çalışır
- FFmpeg kullanımı opsiyoneldir (tarayıcı yöntemi her zaman çalışır)

### 🔄 Güncelleme Notları

**v2.0 - Profesyonel HLS Parser**
- Tamamen yeniden yazıldı
- 3 seviyeli M3U8 parser eklendi
- Modern UI tasarımı
- Gelişmiş segment indirme sistemi
- Ayrı audio/video track desteği

---

**Yedek Dosyalar**
Eski sürümler `.backup` uzantısıyla kaydedildi:
- `background.js.backup`
- `popup.js.backup`
- `popup.html.backup`
- `content.js.backup`
