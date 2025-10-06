// Lightweight wrapper worker for ffmpeg.wasm usage inside extension
// NOTE: You must place ffmpeg-core.js/wasm/worker in the same folder (see README_FFMPEG.txt)

try {
  self.importScripts('ffmpeg-core.js'); // core yükleme
} catch (e) {
  self.postMessage({ type: 'fatal', error: 'ffmpeg-core.js yüklenemedi: '+ e.message + ' (dosya eksik veya web_accessible_resources izinleri)' });
}

let ffmpegLoaded = false;
let ffmpegCore = null; // createFFmpegCore dönen Module
// Not: Bu core sürümünde callMain yok; yerine ffmpegCore.exec(args...) senkron API var.
// High-level wrapper (ffmpeg.min.js) kaldırıldı; yalnızca low-level exec kullanıyoruz.

async function initFFmpeg() {
  if (ffmpegLoaded) return;
  if (typeof self.createFFmpegCore !== 'function') {
    throw new Error('ffmpeg-core.js yüklenemedi (createFFmpegCore yok)');
  }
  // createFFmpegCore is provided by ffmpeg-core.js
  // Here we mimic a minimal FS + run wrapper (low-level API). For simplicity we re-use Module FS.
  ffmpegCore = await self.createFFmpegCore({
    print: (msg) => self.postMessage({ type: 'log', data: msg }),
    printErr: (msg) => self.postMessage({ type: 'error', data: msg }),
    locateFile: (path) => {
      // Worker içinden wasm/worker dosyalarını aynı klasörden yükle
      if (path.endsWith('.wasm') || path.endsWith('.worker.js')) {
        self.postMessage({ type:'log', data:'[locateFile] '+path });
        return path; // aynı dizin
      }
      return path;
    }
  });
  // Bu build'de callMain yok; exec fonksiyonu mevcut olmalı.
  if (typeof ffmpegCore.exec !== 'function') {
    throw new Error('ffmpegCore.exec API bulunamadı (beklenmeyen core derlemesi)');
  }
  // Logger yönlendirme (stdout/stderr ayrımı)
  try {
    ffmpegCore.setLogger((m) => {
      if (!m || !m.type) return;
      if (m.type === 'stdout') {
        self.postMessage({ type: 'log', data: m.message });
      } else if (m.type === 'stderr') {
        // ffmpeg tipik ilerleme satırlarını stderr'de verir
        self.postMessage({ type: 'log', data: m.message });
      }
    });
  } catch (_) {/* bazı sürümlerde setLogger yoksa sessiz geç */}
  self.postMessage({ type:'log', data:'[core] exec API hazır' });
  ffmpegLoaded = true;
  self.postMessage({ type: 'ready' });
}

function writeFile(path, data) {
  const FS = ffmpegCore.FS;
  try {
    FS.writeFile(path, data);
  } catch (e) {
    if (e.code === 'ENOENT') {
      // Ensure directory
      const parts = path.split('/');
      parts.pop();
      let current = '';
      for (const p of parts) {
        if (!p) continue;
        current += '/' + p;
        try { FS.mkdir(current); } catch (_) {}
      }
      FS.writeFile(path, data);
    } else {
      throw e;
    }
  }
}

function readFile(path) {
  return ffmpegCore.FS.readFile(path);
}

function runFFmpeg(args){
  return new Promise((resolve, reject)=>{
    try {
      const code = ffmpegCore.exec(...args); // DEFAULT_ARGS (./ffmpeg -nostdin -y) otomatik ekleniyor
      if(code === 0) return resolve(0);
      reject(new Error('FFmpeg exit code '+code));
    } catch(e){
      reject(e);
    }
  });
}

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try { await initFFmpeg(); } catch (err) { self.postMessage({ type: 'fatal', error: err.message }); }
    return;
  }
  if (msg.type === 'merge') {
    if (!ffmpegLoaded) await initFFmpeg();
    try {
      self.postMessage({ type: 'progress', stage: 'writing_input' });
      const videoU8 = msg.videoBuffer instanceof Uint8Array ? msg.videoBuffer : new Uint8Array(msg.videoBuffer);
      const audioU8 = msg.audioBuffer instanceof Uint8Array ? msg.audioBuffer : new Uint8Array(msg.audioBuffer);
      // Büyük dosyalarda tek seferde yazma bazen FS limitlerine çarpabilir; chunk yaz.
      const CHUNK = 4 * 1024 * 1024; // 4MB daha küçük bloklar
      const FS = ffmpegCore.FS;
      const ensureDir = (dir)=>{ try { FS.mkdir(dir); } catch(e){ /* exists */ } };
      ensureDir('/work');
      const chunkWriteFile = (path, data)=>{
        try { // önce eski dosyayı sil
          try { FS.unlink(path); } catch(_){ }
          let fd = FS.open(path,'w+');
          let offset = 0; let written=0;
          while(offset < data.length){
            const slice = data.subarray(offset, offset+CHUNK);
            FS.write(fd, slice, 0, slice.length, offset);
            offset += slice.length; written += slice.length;
            if(written % (32*1024*1024) === 0){
              self.postMessage({ type:'log', data:`[fs] wrote ${ (written/1024/1024).toFixed(1) }MB -> ${path}` });
            }
          }
          FS.close(fd);
          self.postMessage({ type:'log', data:`[fs] complete ${ (written/1024/1024).toFixed(2) }MB -> ${path}` });
        } catch(e){ throw e; }
      };
      chunkWriteFile('/work/video_all.ts', videoU8);
      chunkWriteFile('/work/audio_all.ts', audioU8);
      self.postMessage({ type: 'progress', stage: 'running_ffmpeg' });

      // Low-level exec tabanlı core yolu
      const baseArgs = [
        '-hide_banner','-loglevel','info',
        '-i','/work/video_all.ts',
        '-i','/work/audio_all.ts',
        '-c','copy',
        '-map','0:v:0','-map','1:a:0',
        '-movflags','faststart',
        '-f','mp4','/work/merged.mp4'
      ];
      let success = false; let lastErr = null;
      try { await runFFmpeg(baseArgs); success = true; } catch (e) { lastErr = e; self.postMessage({ type:'error', data:'[copy-fail] '+e.message }); }
      if(!success){
        self.postMessage({ type:'log', data:'[fallback] audio transcode aac devreye giriyor' });
        const transcodeArgs = [
          '-hide_banner','-loglevel','info',
          '-i','/work/video_all.ts',
          '-i','/work/audio_all.ts',
          '-c:v','copy','-c:a','aac','-b:a','192k',
          '-map','0:v:0','-map','1:a:0',
          '-movflags','faststart',
          '-f','mp4','/work/merged.mp4'
        ];
        try { await runFFmpeg(transcodeArgs); success = true; } catch(e2){ lastErr = e2; }
      }
      if(!success){ throw lastErr || new Error('Mux başarısız'); }
      self.postMessage({ type: 'progress', stage: 'reading_output' });
      const out = readFile('/work/merged.mp4');
      self.postMessage({ type: 'done', buffer: out });
    } catch (err) {
      let msg = err && err.message ? err.message : String(err);
      if(/wasm-eval|unsafe-eval|Content Security Policy/i.test(msg)){
        msg = 'WebAssembly CSP engeli: manifest "content_security_policy.extension_pages" içine wasm-unsafe-eval ekleyin. (Mevcut güncellendiyse uzantıyı yeniden yükleyin) Orijinal: '+msg;
      }
      if(/FS error|bad file descriptor|ENOENT|EIO/i.test(msg)){
        msg = '[FS] Dosya yazma/okuma hatası. Büyük tek seferde yazım başarısız olmuş olabilir; chunk mekanizması devrede. Orijinal: '+msg;
      }
      self.postMessage({ type: 'fatal', error: msg });
    }
  }
};
