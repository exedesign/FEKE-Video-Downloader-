<div align="center">

# FEKE-Video Downloader

Kolay, hızlı ve genişletilebilir bir tarayıcı medya indirme uzantısı.

Desteklenen Tarayıcılar: **Chrome**, **Brave** ve Manifest V3 uyumlu Chromium tabanlı diğer tarayıcılar.

</div>

## 🚀 Genel Bakış
FEKE-Video Downloader; web sayfalarındaki akış (HLS / M3U8) veya doğrudan medya URL'lerini algılayıp tek tıklama ile indirmenizi sağlar. Gömülü segmentleri (TS) birleştirip tek MP4 çıktısı oluşturma özelliği içerir. Geliştirme yaklaşımı modülerdir; gelecek sürümlerde çok daha fazla medya kaynağı ve akış protokolü desteği (isim vermeden genişleyen platform çeşitliliği) planlanmaktadır.

## 🔑 Temel Özellikler
- Otomatik medya & HLS playlist algılama
- Master / Variant / Ayrı Audio playlist ayrıştırma
- Segment birleştirme (copy mux + gerekirse AAC fallback)
- Tek adımda video+ses MP4 çıktısı (FFmpeg WASM entegrasyonu)
- Boyut, süre, ortalama bitrate ve kalite bilgisi
- Bellek dostu chunk yazma stratejisi
- Minimal siyah-beyaz sade arayüz (odağı fonksiyona verir)
- Chromium (Chrome / Brave) MV3 uyumluluk

## 🧩 Mimariden Kısa Notlar
| Bileşen | Rol |
|--------|-----|
| `background.js` | Ağ trafiğinden M3U8 yakalama / sınıflandırma |
| `popup.js` | UI, segment indirme orkestrasyonu, FFmpeg worker yönetimi |
| `ffmpeg/ffmpegWorker.js` | Low-level wasm exec ile mux işlemi |
| `manifest.json` | MV3 izinleri, CSP, erişilebilir kaynaklar |

FFmpeg tarafında çağrılar doğrudan `exec` API'si üzerinden yapılır; wrapper katman kaldırılarak daha deterministik ve hafif bir çalışma sağlanır.

## 🛠 Kurulum (Geliştirici Modu)
1. Tarayıcıda `chrome://extensions/` (Brave için `brave://extensions/`) açın.
2. Sağ üstte **Geliştirici modu**nu etkinleştirin.
3. **Load unpacked / Paketlenmemiş uzantı yükle** butonuna tıklayın.
4. Bu proje klasörünü seçin.
5. (HLS mux için) `ffmpeg/` klasörüne uygun `ffmpeg-core.js` + `.wasm` dosyalarını eklediğinizden emin olun (README_FFMPEG). 

## ▶️ Kullanım Adımları
1. Herhangi bir video / yayın içeren sayfaya gidin.
2. Uzantı ikonunda yakalanan kaynak sayısını görün.
3. Popup'ı açın, listelenen kaynaklardan HLS playlist veya direkt medya dosyasını seçin.
4. HLS ise kalite / audio seçimini doğrulayın.
5. Merge / İndir butonuna basın – segmentler indirilip tek MP4'e dönüştürülür.

## 📦 Release Paketleme (ZIP)
Yeni bir sürüm dağıtmak için proje kök dizininde aşağıdaki işlemleri uygulayın.

### PowerShell (Windows)
```powershell
$version = "v1.0.0"  # düzenleyin
$name    = "FEKE-Video-Downloader-$version"
New-Item -ItemType Directory -Path "$name" | Out-Null
Copy-Item -Recurse -Force .\* "$name" -Exclude *.git*,node_modules,*.ps1
Compress-Archive -Path "$name\*" -DestinationPath "$name.zip" -Force
Remove-Item -Recurse -Force "$name"
```

### Genel (Platform Bağımsız Fikir)
1. Gereksiz geliştirme dosyalarını (geçici, backup) temizleyin.
2. `ffmpeg/` altında çekirdek wasm dosyaları bulunduğundan emin olun.
3. Kökte bir zip oluşturun ve GitHub Releases kısmına yükleyin.

## 🗺 Yol Haritası (Özet)
- Genişleyen platform yelpazesi (isim verilmeden çoğul akış kaynakları)
- Ek akış protokolleri & formatları
- Dinamik kalite adaptasyonu
- Canlı (live) stream zaman kaydı / segment purge yönetimi
- İlerleme yüzdesi için canlı zaman parse (% tamamlanma)
- Abort / Cancel indirme ve worker durdurma
- Bellek kullanımını düşüren streaming append (disk benzeri) mimari

## ❓ Sık Karşılaşılan Durumlar
| Belirti | Açıklama | Çözüm |
|---------|----------|-------|
| `ffmpegCore.exec API bulunamadı` | Yanlış core sürümü | 0.12.6 UMD dosyalarını yeniden kopyala |
| Çıktı sessiz (ses yok) | Copy mux başarısız + fallback tetikle(n)medi | Uzantıyı yeniden yükle / cache temizle |
| Çok yavaş | AAC fallback encode devrede | Codec uyumlu kaynak arayın |
| İndirme başlamıyor | Playlist yakalanmamış olabilir | Sayfayı yenile, popup'ı tekrar aç |

## 🧪 Teknik Detay (Kısa)
- Manifest V3 Service Worker
- Ağ yakalama → playlist ayrıştırma (Master / Variant / Audio)
- Segment indirme → birleşik TS buffer
- FFmpeg wasm (exec) → mux → MP4
- Transferable ArrayBuffer ile daha az kopya
- Chunked FS write (4MB)

## 🔐 Güvenlik & CSP
`wasm-unsafe-eval` izni, wasm modülünün MV3 ortamında yüklenebilmesi için gereklidir; sadece çekirdek kod çalışır, dinamik remote script yoktur.

## 🤝 Katkı
Pull Request öncesi: küçük, odaklı değişiklikler ve kısa açıklama ekleyin. İleride katkı yönergeleri (CONTRIBUTING) eklenecek.

## � Lisans
Bu proje içerisindeki ffmpeg.wasm bileşenleri ilgili (BSD-3-Clause ve FFmpeg (L)GPL) lisans koşullarına tabidir. Kullanımınızda lisans uyumluluğunu gözetin.

---
Gelecek sürümlerde esnek ve ölçeklenebilir çoklu medya işleme yetenekleri eklenmeye devam edecektir.

> “İndir, birleştir, hazır et” – Tek akışta sade deneyim.