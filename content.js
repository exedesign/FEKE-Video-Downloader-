// ============================================================================
// MGX MEDIA DOWNLOADER - CONTENT SCRIPT
// ============================================================================
// Browser-based segment downloading and merging
// ============================================================================

console.log('[MGX Content] Loaded');

// ============================================================================
// DYNAMIC HLS DISCOVERY (fetch/XHR Hook)
// Bazı siteler m3u8 uzantısını gizleyip query param veya blob response ile servis eder.
// Aşağıdaki hook response text içinde #EXTM3U gördüğünde background'a kayıt gönderir.
// ============================================================================
(function enableDynamicHlsCapture(){
  const FORWARD_LIMIT = 3 * 1024 * 1024; // max inspect size
  const originalFetch = window.fetch;
  window.fetch = async function(input, init){
    let url = (typeof input === 'string') ? input : (input?.url || '');
    try {
      const res = await originalFetch.apply(this, arguments);
      // Sadece text/m3u8 veya application/vnd.apple.mpegurl benzeri tiplerde bak
      const ctype = res.headers.get('content-type') || '';
      const probable = /m3u8|mpegurl|application\/octet-stream/i.test(ctype) || /m3u8/i.test(url);
      if(probable){
        try {
          const clone = res.clone();
          const buf = await clone.arrayBuffer();
            const slice = new TextDecoder().decode(buf.slice(0, Math.min(buf.byteLength, FORWARD_LIMIT)));
          if(/#EXTM3U/.test(slice)){
            chrome.runtime.sendMessage({
              type:'REGISTER_M3U8_DYNAMIC',
              url,
              tabId: (chrome.devtools && chrome.devtools.inspectedWindow)? chrome.devtools.inspectedWindow.tabId : null,
              hint: 'force'
            });
          }
        } catch(e){ /* sessiz */ }
      }
      return res;
    } catch(err){
      throw err;
    }
  };

  // XHR override
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url){
    this.__mgx_url = url; return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(){
    const xhr = this;
    xhr.addEventListener('load', function(){
      try {
        const ctype = xhr.getResponseHeader('content-type') || '';
        if(xhr.response && (/#EXTM3U/.test(xhr.response) || /m3u8|mpegurl/i.test(ctype) || /m3u8/i.test(xhr.__mgx_url))){
          chrome.runtime.sendMessage({
            type:'REGISTER_M3U8_DYNAMIC',
            url: xhr.__mgx_url,
            tabId: null,
            hint: /#EXTM3U/.test(xhr.response)?'force':undefined
          });
        }
      } catch(e){ /* ignore */ }
    });
    return origSend.apply(this, arguments);
  };
})();

// ============================================================================
// MESSAGE LISTENER
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  if (request.type === "MERGE_SEGMENTS") {
    console.log(`[MGX Content] Merging ${request.segments.length} segments...`);
    downloadAndMergeSegments(request.segments, request.filename);
    sendResponse({ status: 'started' });
  }
  
  if (request.type === "DOWNLOAD_SEGMENTS") {
    console.log(`[MGX Content] Downloading ${request.fileType}: ${request.segments.length} segments...`);
    downloadSegmentsOnly(request.segments, request.filename, request.fileType);
    sendResponse({ status: 'started' });
  }
  
  if (request.type === "MERGE_VIDEO_AUDIO") {
    console.log(`[MGX Content] Merging video (${request.videoSegments.length}) + audio (${request.audioSegments.length})...`);
    mergeVideoAudioAsMP4(request.videoSegments, request.audioSegments, request.filename);
    sendResponse({ status: 'started' });
  }

  // FFmpeg WASM tabanlı gerçek mux isteği
  if (request.type === 'FFMPEG_MERGE_VIDEO_AUDIO') {
    console.log(`[MGX Content][FFmpeg] Request: videoSeg=${request.videoSegments.length} audioSeg=${request.audioSegments.length}`);
    ffmpegMergeVideoAudio(request.videoSegments, request.audioSegments, request.filename || ('merged_'+Date.now()));
    sendResponse({ status: 'started' });
  }
  
  if (request.type === "FFMPEG_PROGRESS") {
    console.log('[MGX Content] FFmpeg Progress:', request.data);
    showProgress(request.data);
    sendResponse({ status: 'received' });
  }
  
  return true;
});

// ============================================================================
// FFmpeg WASM GERÇEK BİRLEŞTİRME (video.ts + audio.ts -> merged.mp4)
// ============================================================================
async function ffmpegMergeVideoAudio(videoUrls, audioUrls, outBaseName) {
  const progress = createProgressUI();
  updateProgress(progress, 0, 'FFmpeg hazirlik...');

  try {
    if (!videoUrls?.length || !audioUrls?.length) {
      updateProgress(progress, 100, 'Segment listesi bos', true);
      return;
    }

    // 1) Segmentleri indir ve tek buffer yap
    updateProgress(progress, 5, 'Video segment indiriliyor...');
    const videoBuffer = await concatSegmentsToUint8(videoUrls, (done, total) => {
      const pct = 5 + (done/total)*35; // 5-40
      updateProgress(progress, pct, `Video ${done}/${total}`);
    });

    updateProgress(progress, 42, 'Audio segment indiriliyor...');
    const audioBuffer = await concatSegmentsToUint8(audioUrls, (done, total) => {
      const pct = 42 + (done/total)*33; // 42-75
      updateProgress(progress, pct, `Audio ${done}/${total}`);
    });

    updateProgress(progress, 78, 'FFmpeg worker başlatılıyor...');
    const workerUrl = chrome.runtime.getURL('ffmpeg/ffmpegWorker.js');
    const worker = new Worker(workerUrl);

    let ffmpegDone = false;
    const finalFileName = outBaseName + '.mp4';

    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        updateProgress(progress, 82, 'FFmpeg hazir, merge...');
        worker.postMessage({ type: 'merge', videoBuffer, audioBuffer });
      } else if (msg.type === 'progress') {
        if (msg.stage === 'writing_input') updateProgress(progress, 84, 'Girdi yaziliyor...');
        if (msg.stage === 'running_ffmpeg') updateProgress(progress, 88, 'FFmpeg calisiyor...');
        if (msg.stage === 'reading_output') updateProgress(progress, 92, 'Cikti okunuyor...');
      } else if (msg.type === 'log') {
        // İstersen console'a bas
        if (/frame=/.test(msg.data)) updateProgress(progress, 90, 'FFmpeg ilerliyor');
        console.log('[FFmpeg]', msg.data);
      } else if (msg.type === 'error') {
        console.warn('[FFmpeg][stderr]', msg.data);
      } else if (msg.type === 'fatal') {
        console.error('[FFmpeg] Hata:', msg.error);
        updateProgress(progress, 100, 'Hata: '+msg.error, true);
        worker.terminate();
      } else if (msg.type === 'done' && !ffmpegDone) {
        ffmpegDone = true;
        updateProgress(progress, 96, 'Kaydediliyor...');
        const blob = new Blob([msg.buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        updateProgress(progress, 100, 'Bitti: '+finalFileName);
        setTimeout(()=>progress.remove(), 6000);
        worker.terminate();
      }
    };

    worker.postMessage({ type: 'init' });

  } catch (err) {
    console.error('[FFmpeg Merge] Hata:', err);
    updateProgress(progress, 100, 'Hata: '+err.message, true);
    setTimeout(()=>progress.remove(), 6000);
  }
}

async function concatSegmentsToUint8(urls, onEach) {
  const parts = [];
  let downloaded = 0;
  for (let i=0;i<urls.length;i++) {
    try {
      const r = await fetch(urls[i]);
      if (!r.ok) throw new Error('HTTP '+r.status);
      const buf = new Uint8Array(await r.arrayBuffer());
      parts.push(buf);
    } catch (e) {
      console.warn('[FFmpeg] Segment hata, atlandi:', urls[i], e.message);
    }
    downloaded++;
    onEach && onEach(downloaded, urls.length);
  }
  // Concatenate
  let total = 0; parts.forEach(p=> total += p.length);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { merged.set(p, offset); offset += p.length; }
  return merged;
}

// ============================================================================
// MERGE VIDEO + AUDIO AS MP4 (Simple - No external libs)
// ============================================================================
async function mergeVideoAudioAsMP4(videoUrls, audioUrls, filename) {
  const progress = createProgressUI();
  
  try {
    updateProgress(progress, 0, '� İndirme başlıyor...');
    
    const videoCount = videoUrls.length;
    const audioCount = audioUrls.length;
    const hasAudio = audioCount > 0;
    const totalSegments = videoCount + audioCount;
    
    console.log(`[MGX] Video: ${videoCount}, Audio: ${audioCount}`);
    
    if (audioCount === 0) {
      console.warn('[MGX] ⚠️ NO AUDIO URLS PROVIDED! Check popup.js audio parsing.');
    }
    
    // AYRI ARRAY'LER - Video ve Audio ayrı tutulacak!
    const videoBlobs = [];
    const audioBlobs = [];
    let downloadedCount = 0;
    const batchSize = 10;
    
    // Video segmentleri - videoBlobs array'ine ekle
    for (let i = 0; i < videoCount; i += batchSize) {
      const batch = videoUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.blob();
        } catch (error) {
          console.error('[MGX] Video segment error:', error);
          return null;
        }
      });
      
      const results = await Promise.all(batchPromises);
      results.forEach(blob => {
        if (blob) {
          videoBlobs.push(blob);  // Video array'ine ekle
          downloadedCount++;
        }
      });
      
      const percentage = (downloadedCount / totalSegments) * 85;
      updateProgress(progress, percentage, `📹 Video: ${videoBlobs.length}/${videoCount}`);
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Audio segmentleri - audioBlobs array'ine ekle
    if (hasAudio) {
      for (let i = 0; i < audioCount; i += batchSize) {
        const batch = audioUrls.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.blob();
          } catch (error) {
            console.error('[MGX] Audio segment error:', error);
            return null;
          }
        });
        
        const results = await Promise.all(batchPromises);
        results.forEach(blob => {
          if (blob) {
            audioBlobs.push(blob);  // Audio array'ine ekle
            downloadedCount++;
          }
        });
        
        const percentage = (downloadedCount / totalSegments) * 85;
        updateProgress(progress, percentage, `🔊 Audio: ${audioBlobs.length}/${audioCount}`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    updateProgress(progress, 90, '🔄 Birleştiriliyor...');
    
    console.log(`[MGX] Merging ${videoBlobs.length} video + ${audioBlobs.length} audio segments`);
    
    // GERÇEK ÇÖZÜM: mux.js ile TS -> MP4 transmux
    // Ancak mux.js import CSP policy nedeniyle çalışmıyor
    // 
    // ALTERNATİF: Tüm TS segmentlerini birleştir ve browser'ın decode etmesine izin ver
    // Bazı TS stream'leri zaten multiplexed (video+audio birlikte)
    
    const allSegments = [];
    
    if (hasAudio && audioBlobs.length > 0) {
      // DENEYSEL: Video ve Audio TS'lerini CHUNK BAZINDA birleştir
      // Her video chunk'ından sonra karşılık gelen audio chunk'ını ekle
      console.log('[MGX] Attempting chunk-based interleave...');
      
      const minLength = Math.min(videoBlobs.length, audioBlobs.length);
      
      // İlk önce eşleşen chunk'ları interleave et
      for (let i = 0; i < minLength; i++) {
        allSegments.push(videoBlobs[i]);
        allSegments.push(audioBlobs[i]);
      }
      
      // Kalan chunk'ları ekle
      if (videoBlobs.length > minLength) {
        allSegments.push(...videoBlobs.slice(minLength));
      }
      if (audioBlobs.length > minLength) {
        allSegments.push(...audioBlobs.slice(minLength));
      }
      
      console.log(`[MGX] Interleaved ${allSegments.length} total chunks`);
    } else {
      // Sadece video
      console.log('[MGX] Only video segments');
      allSegments.push(...videoBlobs);
    }
    
    console.log(`[MGX] Total merged segments: ${allSegments.length}`);
    
    // MP4 container ile kaydet (bazı player'lar TS'yi desteklemez)
    const mergedBlob = new Blob(allSegments, { type: 'video/mp4' });
    const fileSize = (mergedBlob.size / (1024 * 1024)).toFixed(2);
    
    updateProgress(progress, 96, '💾 Kaydediliyor...');
    
    // İndir
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(progress, 100, `✅ ${fileSize} MB indirildi!`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
    
  } catch (error) {
    console.error('[MGX] Merge error:', error);
    updateProgress(progress, 100, `❌ ${error.message}`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
  }
}

// ============================================================================
// MERGE VIDEO + AUDIO (SIMPLE - Fallback)
// ============================================================================
async function mergeVideoAudioSimple(videoUrls, audioUrls, filename) {
  const progress = createProgressUI();
  
  try {
    updateProgress(progress, 0, '� İndirme başlıyor...');
    
    // Video ve audio segment sayıları
    const videoCount = videoUrls.length;
    const audioCount = audioUrls.length;
    const hasAudio = audioCount > 0;
    
    console.log(`[MGX] Video: ${videoCount}, Audio: ${audioCount}`);
    
    // Tüm segmentleri indir (paralel)
    const allBlobs = [];
    let downloadedCount = 0;
    const totalSegments = videoCount + audioCount;
    const batchSize = 10;
    
    // Video segmentlerini indir
    for (let i = 0; i < videoCount; i += batchSize) {
      const batch = videoUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.blob();
        } catch (error) {
          console.error('[MGX] Video segment error:', error);
          return null;
        }
      });
      
      const results = await Promise.all(batchPromises);
      results.forEach(blob => {
        if (blob) {
          allBlobs.push(blob);
          downloadedCount++;
        }
      });
      
      const percentage = (downloadedCount / totalSegments) * 90;
      updateProgress(progress, percentage, `📹 Video: ${downloadedCount}/${videoCount}`);
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Audio segmentlerini indir (eğer varsa)
    if (hasAudio) {
      const audioStartCount = downloadedCount;
      
      for (let i = 0; i < audioCount; i += batchSize) {
        const batch = audioUrls.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (url) => {
          try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.blob();
          } catch (error) {
            console.error('[MGX] Audio segment error:', error);
            return null;
          }
        });
        
        const results = await Promise.all(batchPromises);
        results.forEach(blob => {
          if (blob) {
            allBlobs.push(blob);
            downloadedCount++;
          }
        });
        
        const percentage = (downloadedCount / totalSegments) * 90;
        const audioDownloaded = downloadedCount - audioStartCount;
        updateProgress(progress, percentage, `🔊 Audio: ${audioDownloaded}/${audioCount}`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    updateProgress(progress, 92, '🔄 Birleştiriliyor...');
    
    // Tüm blob'ları birleştir
    const mergedBlob = new Blob(allBlobs, { type: 'video/mp2t' });
    const fileSize = (mergedBlob.size / (1024 * 1024)).toFixed(2);
    
    updateProgress(progress, 96, '💾 Kaydediliyor...');
    
    // Dosyayı indir
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.ts';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(progress, 100, `✅ ${fileSize} MB indirildi!`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
    
  } catch (error) {
    console.error('[MGX] Merge error:', error);
    updateProgress(progress, 100, `❌ ${error.message}`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
  }
}

// ============================================================================
// MERGE VIDEO + AUDIO WITH FFMPEG.WASM (DEPRECATED - Import issues)
// ============================================================================
async function mergeVideoAudioWithFFmpeg(videoUrls, audioUrls, filename) {
  const progress = createProgressUI();
  
  try {
    // Load FFmpeg
    updateProgress(progress, 0, '🔧 FFmpeg yükleniyor...');
    await loadFFmpeg();
    
    updateProgress(progress, 5, '📹 Video segmentleri indiriliyor...');
    
    // Download video segments
    const videoBlobs = await downloadSegmentsBatch(videoUrls, (downloaded, total) => {
      const percentage = 5 + (downloaded / total) * 35;
      updateProgress(progress, percentage, `📹 Video: ${downloaded}/${total}`);
    });
    
    if (videoBlobs.length === 0) {
      throw new Error('Video segmentleri indirilemedi');
    }
    
    // Merge video blobs
    const videoBlob = new Blob(videoBlobs, { type: 'video/mp2t' });
    
    // Download audio segments if available
    let audioBlob = null;
    if (audioUrls && audioUrls.length > 0) {
      updateProgress(progress, 40, '🔊 Audio segmentleri indiriliyor...');
      
      const audioBlobs = await downloadSegmentsBatch(audioUrls, (downloaded, total) => {
        const percentage = 40 + (downloaded / total) * 20;
        updateProgress(progress, percentage, `🔊 Audio: ${downloaded}/${total}`);
      });
      
      if (audioBlobs.length > 0) {
        audioBlob = new Blob(audioBlobs, { type: 'audio/mp4' });
      }
    }
    
    // FFmpeg Processing
    updateProgress(progress, 60, '⚙️ FFmpeg işleme başlıyor...');
    
    // Write video to FFmpeg virtual filesystem
    await ffmpeg.writeFile('video.ts', new Uint8Array(await videoBlob.arrayBuffer()));
    
    let ffmpegCommand = [];
    
    if (audioBlob) {
      // Write audio to FFmpeg virtual filesystem
      await ffmpeg.writeFile('audio.ts', new Uint8Array(await audioBlob.arrayBuffer()));
      
      updateProgress(progress, 70, '🔄 Video + Audio birleştiriliyor...');
      
      // Merge video and audio
      ffmpegCommand = [
        '-i', 'video.ts',
        '-i', 'audio.ts',
        '-c', 'copy',
        '-f', 'mp4',
        'output.mp4'
      ];
    } else {
      updateProgress(progress, 70, '🔄 Video dönüştürülüyor...');
      
      // Convert video only
      ffmpegCommand = [
        '-i', 'video.ts',
        '-c', 'copy',
        '-f', 'mp4',
        'output.mp4'
      ];
    }
    
    // Execute FFmpeg command
    await ffmpeg.exec(ffmpegCommand);
    
    updateProgress(progress, 90, '💾 Dosya hazırlanıyor...');
    
    // Read output file
    const data = await ffmpeg.readFile('output.mp4');
    const outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
    const fileSize = (outputBlob.size / (1024 * 1024)).toFixed(2);
    
    // Download the file
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Cleanup FFmpeg files
    try {
      await ffmpeg.deleteFile('video.ts');
      if (audioBlob) await ffmpeg.deleteFile('audio.ts');
      await ffmpeg.deleteFile('output.mp4');
    } catch (e) {
      console.log('[MGX FFmpeg] Cleanup warning:', e);
    }
    
    updateProgress(progress, 100, `✅ Tamamlandı! (${fileSize} MB)`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
    
  } catch (error) {
    console.error('[MGX FFmpeg] Merge error:', error);
    updateProgress(progress, 100, `❌ Hata: ${error.message}`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
  }
}

// ============================================================================
// DOWNLOAD AND MERGE SEGMENTS
// ============================================================================
async function downloadAndMergeSegments(segmentUrls, filename) {
  const progress = createProgressUI();
  
  try {
    updateProgress(progress, 0, `0/${segmentUrls.length} segments indiriliyor...`);
    
    const blobs = [];
    let downloaded = 0;
    const batchSize = 5;
    
    // Download in batches
    for (let i = 0; i < segmentUrls.length; i += batchSize) {
      const batch = segmentUrls.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.blob();
        } catch (error) {
          console.error('[MGX Content] Segment error:', error);
          return null;
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach(blob => {
        if (blob) {
          blobs.push(blob);
          downloaded++;
        }
      });
      
      const percentage = (downloaded / segmentUrls.length) * 100;
      updateProgress(progress, percentage, `${downloaded}/${segmentUrls.length} segments indirildi`);
      
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    if (blobs.length === 0) {
      throw new Error('Hiçbir segment indirilemedi');
    }
    
    updateProgress(progress, 100, 'Birleştiriliyor...');
    
    // Merge blobs
    const mergedBlob = new Blob(blobs, { type: 'video/mp2t' });
    const fileSize = (mergedBlob.size / (1024 * 1024)).toFixed(2);
    
    // Download merged file
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.ts';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(progress, 100, `✅ Tamamlandı! (${fileSize} MB)`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 3000);
    
  } catch (error) {
    console.error('[MGX Content] Merge error:', error);
    updateProgress(progress, 100, `❌ Hata: ${error.message}`, true);
  }
}

// ============================================================================
// DOWNLOAD SEGMENTS ONLY (Separate File)
// ============================================================================
async function downloadSegmentsOnly(segmentUrls, filename, fileType) {
  const progress = createProgressUI();
  
  try {
    updateProgress(progress, 0, `${fileType}: 0/${segmentUrls.length} segments indiriliyor...`);
    
    const blobs = await downloadSegmentsBatch(segmentUrls, (downloaded, total) => {
      const percentage = (downloaded / total) * 90;
      updateProgress(progress, percentage, `${fileType}: ${downloaded}/${total}`);
    });
    
    if (blobs.length === 0) {
      throw new Error('Hiçbir segment indirilemedi');
    }
    
    updateProgress(progress, 95, 'Birleştiriliyor...');
    
    // Merge blobs
    const mergedBlob = new Blob(blobs, { 
      type: fileType === 'audio' ? 'audio/mp4' : 'video/mp2t' 
    });
    const fileSize = (mergedBlob.size / (1024 * 1024)).toFixed(2);
    
    // Download merged file
    const url = URL.createObjectURL(mergedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + '.ts';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(progress, 100, `✅ ${fileType} tamamlandı! (${fileSize} MB)`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 3000);
    
  } catch (error) {
    console.error('[MGX Content] Download error:', error);
    updateProgress(progress, 100, `❌ Hata: ${error.message}`, true);
  }
}

// ============================================================================
// DOWNLOAD AND MERGE VIDEO + AUDIO
// ============================================================================
async function downloadAndMergeVideoAudio(videoUrls, audioUrls, filename) {
  const progress = createProgressUI();
  
  try {
    const hasAudio = audioUrls && audioUrls.length > 0;
    const totalSegments = videoUrls.length + (hasAudio ? audioUrls.length : 0);
    
    updateProgress(progress, 0, `Video indiriliyor: 0/${videoUrls.length}...`);
    
    // Download video segments
    const videoBlobs = await downloadSegmentsBatch(videoUrls, (downloaded, total) => {
      const percentage = (downloaded / totalSegments) * 50;
      updateProgress(progress, percentage, `Video: ${downloaded}/${total}`);
    });
    
    if (videoBlobs.length === 0) {
      throw new Error('Video segmentleri indirilemedi');
    }
    
    updateProgress(progress, 50, `Video birleştiriliyor...`);
    const videoBlob = new Blob(videoBlobs, { type: 'video/mp2t' });
    
    let finalBlob = videoBlob;
    
    // Download and merge audio if available
    if (hasAudio) {
      updateProgress(progress, 50, `Audio indiriliyor: 0/${audioUrls.length}...`);
      
      const audioBlobs = await downloadSegmentsBatch(audioUrls, (downloaded, total) => {
        const percentage = 50 + (downloaded / totalSegments) * 40;
        updateProgress(progress, percentage, `Audio: ${downloaded}/${total}`);
      });
      
      if (audioBlobs.length > 0) {
        updateProgress(progress, 90, `Audio birleştiriliyor...`);
        const audioBlob = new Blob(audioBlobs, { type: 'audio/mp4' });
        
        // Combine video and audio blobs
        // Note: Browser can't truly multiplex them, but we'll create a container
        updateProgress(progress, 95, `Video + Audio birleştiriliyor...`);
        finalBlob = new Blob([videoBlob, audioBlob], { type: 'video/mp4' });
      }
    }
    
    // Download the merged file
    const fileSize = (finalBlob.size / (1024 * 1024)).toFixed(2);
    updateProgress(progress, 98, `Dosya kaydediliyor... (${fileSize} MB)`);
    
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename + (hasAudio ? '.mp4' : '.ts');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(progress, 100, `✅ Tamamlandı! (${fileSize} MB)`, true);
    
    setTimeout(() => {
      progress.remove();
    }, 5000);
    
  } catch (error) {
    console.error('[MGX Content] Video+Audio merge error:', error);
    updateProgress(progress, 100, `❌ Hata: ${error.message}`, true);
  }
}

// ============================================================================
// DOWNLOAD SEGMENTS IN BATCHES (Helper)
// ============================================================================
async function downloadSegmentsBatch(urls, progressCallback) {
  const blobs = [];
  let downloaded = 0;
  const batchSize = 5;
  
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.blob();
      } catch (error) {
        console.error('[MGX Content] Segment error:', url, error);
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    batchResults.forEach(blob => {
      if (blob) {
        blobs.push(blob);
        downloaded++;
      }
    });
    
    if (progressCallback) {
      progressCallback(downloaded, urls.length);
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return blobs;
}

// ============================================================================
// PROGRESS UI
// ============================================================================
function createProgressUI() {
  const existing = document.getElementById('mgx-progress');
  if (existing) existing.remove();
  
  const div = document.createElement('div');
  div.id = 'mgx-progress';
  div.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px 25px;
    border-radius: 12px;
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    min-width: 320px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  `;
  
  div.innerHTML = `
    <div style="font-weight: 600; margin-bottom: 12px; font-size: 14px;">
      🎬 MGX Media Downloader
    </div>
    <div id="mgx-progress-bar" style="background: rgba(255,255,255,0.2); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
      <div id="mgx-progress-fill" style="background: white; height: 100%; width: 0%; transition: width 0.3s; border-radius: 4px;"></div>
    </div>
    <div id="mgx-progress-text" style="font-size: 12px; opacity: 0.9;">Başlatılıyor...</div>
  `;
  
  document.body.appendChild(div);
  return div;
}

function updateProgress(progressDiv, percentage, text, complete = false) {
  const fill = progressDiv.querySelector('#mgx-progress-fill');
  const textEl = progressDiv.querySelector('#mgx-progress-text');
  
  fill.style.width = percentage + '%';
  textEl.textContent = text;
  
  if (complete) {
    fill.style.background = text.includes('❌') ? '#e74c3c' : '#27ae60';
  }
}

function showProgress(data) {
  const progress = document.getElementById('mgx-progress') || createProgressUI();
  
  if (data.percentage !== undefined) {
    updateProgress(progress, data.percentage, data.status || 'İşleniyor...');
  } else if (data.message) {
    updateProgress(progress, 50, data.message);
  }
}
