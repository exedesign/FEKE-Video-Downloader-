LOW-LEVEL FFMPEG WASM (exec API) ENTEGRASYONU
============================================

Bu klasör uzantının HLS segmentlerini (video + audio) indirip tek bir MP4 çıkışına
birleştirmesi (mux) için gerekli ffmpeg.wasm çekirdek dosyalarını barındırır.

KULLANILAN YAKLAŞIM
-------------------
High-level @ffmpeg/ffmpeg wrapper (createFFmpeg) kaldırıldı. Bunun yerine
@ffmpeg/core 0.12.6 UMD derlemesinin sağladığı low-level Module.exec API
doğrudan kullanılıyor. Bu sürümde callMain yok; exec(...args) çağrıları
DEFAULT_ARGS (./ffmpeg -nostdin -y) üzerine ek argümanlarla çalışır.

GEREKLİ DOSYALAR (AYNI SÜRÜM)
-----------------------------
	- ffmpeg-core.js      (Module + exec)
	- ffmpeg-core.wasm    (WASM binary)
	- ffmpeg-core.worker.js (opsiyonel; yoksa yine çalışır)

Kaynak (resmi release):
	https://github.com/ffmpegwasm/ffmpeg.wasm/releases

İndirdikten sonra kopyala:
	MGX-MediaDownloader/ffmpeg/

KURULUM DOĞRULAMA
-----------------
1. Uzantıyı Developer Mode’da Reload.
2. Bir HLS (m3u8) sayfasını aç ve popup’tan kalite/audio seç.
3. Merge başlat; log sırası örnek:
		 [core] ffmpeg-core.js size=...
		 [core] ffmpeg-core.wasm size=...
		 [core] ffmpeg-core.worker.js erişilemedi (opsiyonel) / veya size=...
		 [core] OK js=true wasm=true worker=(true|false)
		 [core] exec API hazır
		 [stage] writing_input
		 [stage] running_ffmpeg
		 Input #0, mpegts, from '/work/video_all.ts':
		 Input #1, mpegts, from '/work/audio_all.ts':
		 Stream mapping:
		 ... ilerleme stderr satırları ...
		 [progress] reading_output
		 [done]

ÇALIŞMA AKIŞI
-------------
1) Master + variant + audio playlist parse.
2) Segmentler indirilip iki büyük buffer halinde birleştirilir:
			/work/video_all.ts
			/work/audio_all.ts
3) İlk deneme (kayıpsız mux):
			-c copy -map 0:v:0 -map 1:a:0 -movflags faststart
4) Hata olursa (codec/container uyumsuzluğu): AAC transcode fallback:
			-c:v copy -c:a aac -b:a 192k
5) /work/merged.mp4 okunup ana thread’e gönderilir ve indirilir.

FALLBACK MANTIĞI
----------------
Copy mux hızlıdır (yeniden encode yok). Başarısızlık durumunda sadece ses aac’e
çevirilir; video still copy. İşlem süresi uzayabilir.

PERFORMANS / BELLEK
-------------------
- Büyük videolarda (1+ saat) birleşik TS dosyaları belleği büyütür.
- Chunked FS yazımı (4MB) bellek patlamasını azaltır ama toplam RAM yine segment
	boyutları kadardır.
- Gelecek: Streaming incremental append (daha düşük peak RAM).

MUHTEMEL GELİŞTİRMELER
-----------------------
- Abort/Cancel (fetch abort + worker terminate)
- Tek playlist (audio+video birlikte) için audio ayırma atlama
- FFmpeg stderr time= regex ile ilerleme yüzdesi

SORUN GİDERME
-------------
Belirti: [fatal] ffmpegCore.exec API bulunamadı
	Neden: Yanlış core sürümü (callMain varyantı) veya bozuk dosya.
	Çözüm: 0.12.6 UMD ffmpeg-core.js + wasm dosyalarını tekrar kopyalayın.

Belirti: [fatal] ffmpeg-core.js fetch error: Failed to fetch
	Neden: Dosya yol/izin hatası.
	Çözüm: Üç dosyanın aynı klasörde ve manifest web_accessible listesinde olduğundan emin olun.

Belirti: Çıktı video var ses yok
	Neden: copy mux başarısız + fallback tetiklenemedi (eski worker cache?).
	Çözüm: Uzantıyı tamamen kaldırıp yeniden yükleyin.

Belirti: Çok yavaş
	Neden: Fallback (AAC transcode) devrede.
	Çözüm: Orijinal audio codec destekliyse harici mux veya farklı kaynak.

LİSANS
------
ffmpeg.wasm BSD-3-Clause; gömülü FFmpeg için ilgili (L)GPL yükümlülüklerine uyun.
LICENSE dosyalarını projeye ekleyin (FFmpeg kaynak bildirimleri dahil).

