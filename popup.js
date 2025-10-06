// ============================================================================
// MGX MEDIA DOWNLOADER - POPUP UI (CLEAN VERSION)
// ============================================================================
console.log('[MGX Popup] Minimal UI init');
let currentTabId = null;
let cachedM3U8 = [];
document.addEventListener('DOMContentLoaded', () => { initMinimal(); });

// ============================================================================
// LOAD MEDIA FILES
// ============================================================================
function initMinimal(){
  chrome.tabs.query({active:true,currentWindow:true}, tabs=>{
    if(!tabs[0]) return; currentTabId = tabs[0].id; refreshSources();
    const titleEl = document.getElementById('pageTitle');
    if(titleEl) titleEl.textContent = (tabs[0].title || '').trim();
    document.getElementById('downloadBtn').addEventListener('click', startDownloadClicked);
  });
}

function refreshSources(){
  chrome.runtime.sendMessage({ type:'GET_MEDIA_FILES', tabId: currentTabId }, res=>{
    if(!res) return; cachedM3U8 = res.m3u8Files||[]; buildSources();
  });
}

// ============================================================================
// DISPLAY MEDIA FILES
// ============================================================================
async function buildSources(){
  clearError();
  const vSel = document.getElementById('videoSelect');
  const aSel = document.getElementById('audioSelect');
  vSel.innerHTML=''; aSel.innerHTML='';
  const masters = cachedM3U8.filter(f=>f.type==='master');
  let variantEntries = [];
  let audioEntries = [];

  if(masters.length){
    // İlk master'ı parse et (gerekirse daha sonra seçim eklenebilir)
    const masterUrl = masters[0].url;
    await new Promise(resolve=>{
      chrome.runtime.sendMessage({type:'PARSE_M3U8', url:masterUrl, tabId:currentTabId}, masterRes=>{
        if(masterRes && masterRes.variants){
          variantEntries = masterRes.variants.map(v=>({ url:v.url, label: qualityLabel(v) }));
        }
        if(masterRes && masterRes.audioTracks){
          audioEntries = masterRes.audioTracks.map(a=>({ url:a.uri, label: audioLabel(a), isDefault:a.default }));
        }
        resolve();
      });
    });
  }

  // Master yoksa fallback variant/audio listesi (yakalanmış dosyalardan)
  if(!variantEntries.length){
    const rawVariants = cachedM3U8.filter(f=>f.type==='variant');
    variantEntries = rawVariants.map(v=>({url:v.url, label: inferQualityFromName(v.url)}));
  }
  if(!audioEntries.length){
    const rawAudios = cachedM3U8.filter(f=>f.type==='audio');
    audioEntries = rawAudios.map(a=>({url:a.url, label: a.url.split('/').pop()}));
  }

  // Variantları kaliteye göre sırala (yüksek → düşük)
  variantEntries.sort((a,b)=> qualitySortKey(b.label)-qualitySortKey(a.label));

  variantEntries.forEach(v=>{ const o=document.createElement('option'); o.value=v.url; o.textContent=v.label; vSel.appendChild(o); });
  audioEntries.forEach(a=>{ const o=document.createElement('option'); o.value=a.url; o.textContent=a.label; if(a.isDefault) o.dataset.default='1'; aSel.appendChild(o); });

  // Otomatik en yüksek kalite (ilk sırada zaten yüksek)
  if(vSel.options.length) vSel.selectedIndex=0;
  // Varsayılan audio (default attr) yoksa ilk
  let defaultAudioIndex = Array.from(aSel.options).findIndex(op=>op.dataset.default==='1');
  if(defaultAudioIndex<0) defaultAudioIndex=0; if(aSel.options.length) aSel.selectedIndex=defaultAudioIndex;

  if(!vSel.options.length || !aSel.options.length){ setError('Variant veya audio bulunamadı'); }
}

function qualityLabel(v){
  // v.resolution örn: 1920x1080
  if(v.resolution){
    const h = parseInt(v.resolution.split('x')[1]);
    const base = (v.quality||heightToName(h)) + ' ' + v.resolution;
    let extras = [];
    if(v.frameRate) extras.push(v.frameRate+'fps');
    if(v.bandwidth) extras.push(Math.round(v.bandwidth/1000)+'kbps');
    if(v.codecs){ const c = v.codecs.split(',')[0].replace(/"/g,''); extras.push(c); }
    return base + (extras.length? (' ['+extras.join(' / ')+']'):'');
  }
  return v.quality || inferQualityFromName(v.url);
}
function audioLabel(a){
  const parts=[]; parts.push(a.name||a.language||'Audio');
  if(a.language && a.language!==a.name) parts.push(a.language);
  if(a.default) parts.push('DEF');
  return parts.join(' / ') + ' - ' + a.uri.split('/').pop();
}
function inferQualityFromName(url){
  const name = url.split('/').pop();
  const m = name.match(/(\d{3,4})p/i); if(m) return m[1]+'p';
  if(/4k/i.test(name)) return '4K';
  return name;
}
function heightToName(h){ if(h>=2160) return '4K'; if(h>=1440) return '1440p'; if(h>=1080) return '1080p'; if(h>=720) return '720p'; if(h>=480) return '480p'; if(h>=360) return '360p'; return h+'p'; }
function qualitySortKey(label){
  if(/4k/i.test(label)) return 4000;
  const m = label.match(/(\d{3,4})p/); return m? parseInt(m[1]) : 0;
}

function startDownloadClicked(){
  clearError(); const vUrl=document.getElementById('videoSelect').value; const aUrl=document.getElementById('audioSelect').value;
  if(!vUrl||!aUrl){ setError('URL eksik'); return; }
  disableUI(); parseAndMergeFFmpeg(vUrl,aUrl);
}

// ============================================================================
// ADD MERGE PANEL
// ============================================================================
// Eski merge panel fonksiyonu kaldırıldı

// ============================================================================
// DOWNLOAD SEPARATELY (Video and Audio as separate files)
// ============================================================================
function downloadSeparately(videoUrl, audioUrl, panelElement) {
  const progressDiv = createProgressIndicator(panelElement);
  updateProgress(progressDiv, 0, 'Video analiz...');
  
  // Parse video M3U8
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: videoUrl,
    tabId: currentTabId
  }, (videoResult) => {
    if (videoResult.error || !videoResult.segments) {
      updateProgress(progressDiv, 100, 'Video hatasi', true);
      return;
    }
    
    updateProgress(progressDiv, 20, 'Audio analiz...');
    
    // Parse audio M3U8
    chrome.runtime.sendMessage({
      type: "PARSE_M3U8",
      url: audioUrl,
      tabId: currentTabId
    }, (audioResult) => {
      if (audioResult.error || !audioResult.segments) {
        updateProgress(progressDiv, 100, 'Audio hatasi', true);
        return;
      }
      
      const videoSegments = videoResult.segments.map(s => s.url);
      const audioSegments = audioResult.segments.map(s => s.url);
      
      console.log('[MGX] Separate download - Video: ' + videoSegments.length + ', Audio: ' + audioSegments.length);
      
      // Download both separately (2 files)
      downloadBothSeparately(videoSegments, audioSegments, progressDiv);
    });
  });
}

// ============================================================================
// DOWNLOAD BOTH SEPARATELY (2 files: video.mp4 + audio.mp4)
// ============================================================================
async function downloadBothSeparately(videoUrls, audioUrls, progressDiv) {
  try {
    const batchSize = 10;
    const timestamp = Date.now();
    
    // 1. İNDİR VIDEO
    updateProgress(progressDiv, 30, 'Video indiriliyor: 0/' + videoUrls.length);
    const videoBlobs = [];
    
    for (let i = 0; i < videoUrls.length; i += batchSize) {
      const batch = videoUrls.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(url => fetch(url).then(r => r.blob()).catch(e => null))
      );
      
      results.forEach(blob => { if (blob) videoBlobs.push(blob); });
      
      const progress = 30 + (videoBlobs.length / videoUrls.length) * 30;
      updateProgress(progressDiv, progress, 'Video: ' + videoBlobs.length + '/' + videoUrls.length);
    }
    
    const videoFile = new Blob(videoBlobs, { type: 'video/mp4' });
    const videoSize = (videoFile.size / (1024 * 1024)).toFixed(2);
    console.log('[MGX] Video file ready:', videoSize, 'MB');
    
    // KAYDET VIDEO
    const videoUrl = URL.createObjectURL(videoFile);
    const videoLink = document.createElement('a');
    videoLink.href = videoUrl;
    videoLink.download = 'video_' + timestamp + '.mp4';
    document.body.appendChild(videoLink);
    videoLink.click();
    document.body.removeChild(videoLink);
    URL.revokeObjectURL(videoUrl);
    
    console.log('[MGX] ✅ Video saved:', 'video_' + timestamp + '.mp4');
    
    // 2. İNDİR AUDIO
    updateProgress(progressDiv, 65, 'Audio indiriliyor: 0/' + audioUrls.length);
    const audioBlobs = [];
    
    for (let i = 0; i < audioUrls.length; i += batchSize) {
      const batch = audioUrls.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(url => fetch(url).then(r => r.blob()).catch(e => null))
      );
      
      results.forEach(blob => { if (blob) audioBlobs.push(blob); });
      
      const progress = 65 + (audioBlobs.length / audioUrls.length) * 30;
      updateProgress(progressDiv, progress, 'Audio: ' + audioBlobs.length + '/' + audioUrls.length);
    }
    
    const audioFile = new Blob(audioBlobs, { type: 'audio/mp4' });
    const audioSize = (audioFile.size / (1024 * 1024)).toFixed(2);
    console.log('[MGX] Audio file ready:', audioSize, 'MB');
    
    // KAYDET AUDIO
    const audioUrl = URL.createObjectURL(audioFile);
    const audioLink = document.createElement('a');
    audioLink.href = audioUrl;
    audioLink.download = 'audio_' + timestamp + '.mp4';
    document.body.appendChild(audioLink);
    audioLink.click();
    document.body.removeChild(audioLink);
    URL.revokeObjectURL(audioUrl);
    
    console.log('[MGX] ✅ Audio saved:', 'audio_' + timestamp + '.mp4');
    
    updateProgress(progressDiv, 100, 'Video: ' + videoSize + 'MB + Audio: ' + audioSize + 'MB indirildi!', false);
    
    setTimeout(() => progressDiv.remove(), 5000);
    
  } catch (error) {
    console.error('[MGX] Separate download error:', error);
    updateProgress(progressDiv, 100, 'Hata: ' + error.message, true);
  }
}

// ============================================================================
// MERGE VIDEO AUDIO
// ============================================================================
function mergeVideoAudio(videoUrl, audioUrl, panelElement) {
  const progressDiv = createProgressIndicator(panelElement);
  updateProgress(progressDiv, 0, 'Video analiz...');
  
  // Parse video M3U8
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: videoUrl,
    tabId: currentTabId
  }, (videoResult) => {
    if (videoResult.error || !videoResult.segments) {
      updateProgress(progressDiv, 100, 'Video hatasi', true);
      return;
    }
    
    updateProgress(progressDiv, 10, 'Audio analiz...');
    
    // Parse audio M3U8
    chrome.runtime.sendMessage({
      type: "PARSE_M3U8",
      url: audioUrl,
      tabId: currentTabId
    }, (audioResult) => {
      console.log('[MGX Popup] Audio M3U8 parse result:', audioResult);
      
      if (audioResult.error || !audioResult.segments) {
        console.error('[MGX Popup] Audio parse FAILED!', audioResult.error);
        updateProgress(progressDiv, 100, 'Audio hatasi: ' + (audioResult.error || 'Segment yok'), true);
        return;
      }
      
      const videoSegments = videoResult.segments.map(s => s.url);
      const audioSegments = audioResult.segments.map(s => s.url);
      
      console.log('[MGX Popup] ✅ Merge ready:');
      console.log('  Video segments:', videoSegments.length, '- First:', videoSegments[0]);
      console.log('  Audio segments:', audioSegments.length, '- First:', audioSegments[0]);
      
      if (audioSegments.length === 0) {
        console.error('[MGX Popup] ⚠️ AUDIO SEGMENTS EMPTY after parse!');
      }
      
      updateProgress(progressDiv, 20, 'Video indiriliyor...');
      
      // AYRI AYRI İNDİR - Önce video, sonra audio
      downloadSegmentsSequentially(videoSegments, audioSegments, progressDiv, panelElement);
    });
  });
}

// ============================================================================
// START FFMPEG MERGE (Gerçek mux için content script'e delegasyon)
// ============================================================================
function startFFmpegMerge(videoUrl, audioUrl, panelElement) {
  const progressDiv = createProgressIndicator(panelElement);
  updateProgress(progressDiv, 0, 'Video analiz...');

  chrome.runtime.sendMessage({ type: 'PARSE_M3U8', url: videoUrl, tabId: currentTabId }, (videoResult) => {
    if (videoResult?.error || !videoResult?.segments) {
      updateProgress(progressDiv, 100, 'Video parse hatasi', true);
      return;
    }
    updateProgress(progressDiv, 10, 'Audio analiz...');
    chrome.runtime.sendMessage({ type: 'PARSE_M3U8', url: audioUrl, tabId: currentTabId }, (audioResult) => {
      if (audioResult?.error || !audioResult?.segments) {
        updateProgress(progressDiv, 100, 'Audio parse hatasi', true);
        return;
      }
      const videoSegs = videoResult.segments.map(s=>s.url);
      const audioSegs = audioResult.segments.map(s=>s.url);
      updateProgress(progressDiv, 18, `FFmpeg hazirlaniyor V:${videoSegs.length} A:${audioSegs.length}`);
      chrome.tabs.query({active:true,currentWindow:true}, (tabs)=>{
        if(!tabs[0]) { updateProgress(progressDiv, 100, 'Sekme yok', true); return; }
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'FFMPEG_MERGE_VIDEO_AUDIO',
          videoSegments: videoSegs,
            audioSegments: audioSegs,
          filename: 'ffmpeg_merged_' + Date.now()
        });
        updateProgress(progressDiv, 25, 'Segmentler indiriliyor (FFmpeg)...');
      });
    });
  });
}

// =================== Yeni Minimal FFmpeg Akışı ===================== //
function disableUI(){ document.getElementById('downloadBtn').disabled=true; }
function enableUI(){ document.getElementById('downloadBtn').disabled=false; }
function setProgress(p,text){ const box=document.getElementById('progressBox'); box.classList.remove('hidden'); document.getElementById('pFill').style.width=p+'%'; document.getElementById('pStatus').textContent=text; }
function setError(msg){ const e=document.getElementById('pError'); e.textContent=msg; e.classList.remove('hidden'); }
function clearError(){ const e=document.getElementById('pError'); e.classList.add('hidden'); }
function appendLog(line){ const logEl=document.getElementById('pLog'); logEl.classList.remove('hidden'); logEl.textContent += line+"\n"; logEl.scrollTop = logEl.scrollHeight; }

function parseAndMergeFFmpeg(videoUrl,audioUrl){
  const t0 = performance.now();
  setProgress(0,'Video playlist parse...');
  chrome.runtime.sendMessage({type:'PARSE_M3U8', url:videoUrl, tabId:currentTabId}, vRes=>{
    if(!vRes||vRes.error||!vRes.segments){ setError('Video parse hatası'); enableUI(); return; }
    const tVideoParsed = performance.now();
    appendLog(`[parse] video segments=${vRes.segments.length} totalDuration=${Math.round(vRes.totalDuration||0)}s`);
    setProgress(5,'Audio playlist parse...');
    chrome.runtime.sendMessage({type:'PARSE_M3U8', url:audioUrl, tabId:currentTabId}, aRes=>{
      if(!aRes||aRes.error||!aRes.segments){ setError('Audio parse hatası'); enableUI(); return; }
      const tAudioParsed = performance.now();
      appendLog(`[parse] audio segments=${aRes.segments.length} totalDuration=${Math.round(aRes.totalDuration||0)}s`);
      const vSegs=vRes.segments.map(s=>s.url); const aSegs=aRes.segments.map(s=>s.url);
      setProgress(10,`Segment sayısı V:${vSegs.length} A:${aSegs.length}`);
      startWorkerMerge(vSegs,aSegs,{
        timings:{ t0, tVideoParsed, tAudioParsed },
        video:{ segments:vSegs.length, duration:vRes.totalDuration||0 },
        audio:{ segments:aSegs.length, duration:aRes.totalDuration||0 }
      });
    });
  });
}

function startWorkerMerge(videoSegs,audioSegs,meta){
  const tDownloadStart = performance.now();
  let tVideoDone=0, tAudioDone=0, tWorkerReady=0, tMuxDone=0;
  appendLog(`[download] video segments start count=${videoSegs.length}`);
  downloadConcat(videoSegs, (done,total)=>{ setProgress(10 + (done/total)*30, `Video ${done}/${total}`); })
    .then(vBuf=>{
      tVideoDone = performance.now();
      const vMB = (vBuf.length/1024/1024).toFixed(2);
      appendLog(`[download] video complete bytes=${vBuf.length} (${vMB}MB)`);
      appendLog(`[stats] video avgSegmentBytes=${Math.round(vBuf.length/Math.max(1,meta.video.segments))}`);
      return downloadConcat(audioSegs,(done,total)=>{ setProgress(42 + (done/total)*33, `Audio ${done}/${total}`); })
        .then(aBuf=>({vBuf,aBuf}));
    })
    .then(async ({vBuf,aBuf})=>{
      tAudioDone = performance.now();
      const aMB = (aBuf.length/1024/1024).toFixed(2);
      appendLog(`[download] audio complete bytes=${aBuf.length} (${aMB}MB)`);
      appendLog(`[stats] audio avgSegmentBytes=${Math.round(aBuf.length/Math.max(1,meta.audio.segments))}`);
      const totalMB = ((vBuf.length+aBuf.length)/1024/1024).toFixed(2);
      appendLog(`[stats] combinedMB=${totalMB}`);
      if(meta.video.duration && meta.audio.duration){
        appendLog(`[duration] video=${meta.video.duration.toFixed(1)}s audio=${meta.audio.duration.toFixed(1)}s`);
        const avgBitrateMbps = ((vBuf.length + aBuf.length) * 8 / (meta.video.duration*1000*1000)).toFixed(2);
        appendLog(`[bitrate] approxCombined=${avgBitrateMbps} Mbps`);
      }
      setProgress(74,'Çekirdek kontrol ediliyor');
      const coreCheck = await verifyFfmpegCore();
      if(!coreCheck.ok){ setError(coreCheck.message); appendLog('[fatal] '+coreCheck.message); enableUI(); return; }
      appendLog('[core] OK js='+coreCheck.core+' wasm='+coreCheck.wasm+' worker='+coreCheck.worker);
      setProgress(78,'FFmpeg başlatılıyor');
      const workerUrl = chrome.runtime.getURL('ffmpeg/ffmpegWorker.js');
      let w; try { w = new Worker(workerUrl); } catch(e){ setError('Worker oluşturulamadı: '+e.message); enableUI(); return; }
      let lastFrame = 0;
      let readyTimeout = setTimeout(()=>{ setError('FFmpeg başlatılamadı (timeout)'); appendLog('[timeout] ready gelmedi'); enableUI(); try{w.terminate();}catch(_){ } }, 7000);
      w.onmessage = (ev)=>{
        const m=ev.data;
        if(m.type==='ready'){ 
          tWorkerReady=performance.now();
          setProgress(82,'Merge başlıyor');
          appendLog('[ready] transferable gönderiliyor');
          try {
            // ArrayBuffer transfer ile kopyasız gönder
            w.postMessage({type:'merge', videoBuffer:vBuf.buffer, audioBuffer:aBuf.buffer}, [vBuf.buffer, aBuf.buffer]);
          } catch(trErr){
            appendLog('[warn] transferable postMessage başarısız, normal gönderim');
            w.postMessage({type:'merge', videoBuffer:vBuf, audioBuffer:aBuf});
          }
        }
        else if(m.type==='progress'){ appendLog('[stage] '+m.stage); if(m.stage==='running_ffmpeg') setProgress(88,'FFmpeg çalışıyor'); }
        else if(m.type==='log'){
          appendLog(m.data);
          const frameMatch = m.data.match(/frame=\s*(\d+)/);
            if(frameMatch){
              const frame = parseInt(frameMatch[1]); if(frame>lastFrame){ lastFrame=frame; const dyn = 88 + Math.min(6, Math.log10(frame+1)*3); setProgress(dyn, 'FFmpeg frame '+frame); }
            }
            const timeMatch = m.data.match(/time=([0-9:.]+)/);
            if(timeMatch){ setProgress(94,'Zaman '+timeMatch[1]); }
        }
        else if(m.type==='error'){ appendLog('[stderr] '+m.data); }
  else if(m.type==='fatal'){ clearTimeout(readyTimeout); appendLog('[fatal] '+m.error); setError('FFmpeg hata: '+m.error); enableUI(); w.terminate(); logTimings(); }
        else if(m.type==='done'){ clearTimeout(readyTimeout); tMuxDone=performance.now(); setProgress(96,'Kaydediliyor'); appendLog('[done] output ok'); const blob=new Blob([m.buffer],{type:'video/mp4'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download= buildFileName() + '.mp4'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); setProgress(100,'Tamamlandı'); enableUI(); w.terminate(); logTimings(); }

        function logTimings(){
          const tEnd = tMuxDone || performance.now();
          const toMs = (x)=> (x).toFixed(0)+'ms';
          appendLog(`[timing] parse->videoDL ${toMs(tVideoDone - meta.timings.t0)}`);
          appendLog(`[timing] videoDL->audioDL ${toMs(tAudioDone - tVideoDone)}`);
          appendLog(`[timing] audioDL->workerReady ${tWorkerReady?toMs(tWorkerReady - tAudioDone):'n/a'}`);
          appendLog(`[timing] workerReady->muxDone ${tWorkerReady&&tMuxDone?toMs(tMuxDone - tWorkerReady):'n/a'}`);
          appendLog(`[timing] TOTAL ${toMs(tEnd - meta.timings.t0)}`);
        }
      };
      w.postMessage({type:'init'});
    })
    .catch(err=>{ setError('İndirme hata: '+err.message); appendLog('[fatal] downloadConcat '+err.message); enableUI(); });
}

async function downloadConcat(urls,onEach){
  let parts=[]; let done=0;
  for(const u of urls){ try{ const r=await fetch(u); if(!r.ok) throw new Error('HTTP '+r.status); const ab=await r.arrayBuffer(); parts.push(new Uint8Array(ab)); }catch(e){ console.warn('Segment hata',u,e.message);} done++; onEach&&onEach(done,urls.length); }
  let total=parts.reduce((a,b)=>a+b.length,0); const merged=new Uint8Array(total); let off=0; parts.forEach(p=>{ merged.set(p,off); off+=p.length; }); return merged; }

// ============================================================================
// DOWNLOAD SEGMENTS SEQUENTIALLY (Video first, then Audio, then Merge in Browser)
// ============================================================================
async function downloadSegmentsSequentially(videoUrls, audioUrls, progressDiv, panelElement) {
  try {
    console.log('[MGX] Starting 3-stage merge process...');
    console.log('  Video URLs:', videoUrls.length);
    console.log('  Audio URLs:', audioUrls.length);
    
    const batchSize = 10;
    
    // ============================================================
    // STAGE 1: VIDEO SEGMENT'LERİNİ BİRLEŞTİR → tek video.mp4
    // ============================================================
    updateProgress(progressDiv, 10, 'Video segment indirme: 0/' + videoUrls.length);
    const videoBlobs = [];
    
    for (let i = 0; i < videoUrls.length; i += batchSize) {
      const batch = videoUrls.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(url => fetch(url).then(r => r.blob()).catch(e => {
          console.error('[MGX] Video segment error:', e);
          return null;
        }))
      );
      
      results.forEach(blob => { if (blob) videoBlobs.push(blob); });
      
      const progress = 10 + (videoBlobs.length / videoUrls.length) * 30;
      updateProgress(progressDiv, progress, 'Video segment: ' + videoBlobs.length + '/' + videoUrls.length);
    }
    
    console.log('[MGX] ✅ Stage 1: Video segments downloaded:', videoBlobs.length);
    
    updateProgress(progressDiv, 40, 'Video segment birlestiriliyor...');
    const videoFile = new Blob(videoBlobs, { type: 'video/mp4' });
    const videoSize = (videoFile.size / (1024 * 1024)).toFixed(2);
    console.log('[MGX] ✅ Stage 1 COMPLETE: Video file created -', videoSize, 'MB');
    
    // ============================================================
    // STAGE 2: AUDIO SEGMENT'LERİNİ BİRLEŞTİR → tek audio.mp4
    // ============================================================
    updateProgress(progressDiv, 45, 'Audio segment indirme: 0/' + audioUrls.length);
    const audioBlobs = [];
    
    for (let i = 0; i < audioUrls.length; i += batchSize) {
      const batch = audioUrls.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(url => fetch(url).then(r => r.blob()).catch(e => {
          console.error('[MGX] Audio segment error:', e);
          return null;
        }))
      );
      
      results.forEach(blob => { if (blob) audioBlobs.push(blob); });
      
      const progress = 45 + (audioBlobs.length / audioUrls.length) * 30;
      updateProgress(progressDiv, progress, 'Audio segment: ' + audioBlobs.length + '/' + audioUrls.length);
    }
    
    console.log('[MGX] ✅ Stage 2: Audio segments downloaded:', audioBlobs.length);
    
    updateProgress(progressDiv, 75, 'Audio segment birlestiriliyor...');
    const audioFile = new Blob(audioBlobs, { type: 'audio/mp4' });
    const audioSize = (audioFile.size / (1024 * 1024)).toFixed(2);
    console.log('[MGX] ✅ Stage 2 COMPLETE: Audio file created -', audioSize, 'MB');
    
    // ============================================================
    // STAGE 3: VIDEO + AUDIO DOSYALARINI BİRLEŞTİR → merged.mp4
    // ============================================================
    updateProgress(progressDiv, 80, 'Video + Audio birlestiriliyor...');
    console.log('[MGX] Stage 3: Merging video.mp4 (' + videoSize + 'MB) + audio.mp4 (' + audioSize + 'MB)...');
    
    const mergedFile = new Blob([videoFile, audioFile], { type: 'video/mp4' });
    const totalSize = (mergedFile.size / (1024 * 1024)).toFixed(2);
    
    console.log('[MGX] ✅ Stage 3 COMPLETE: Merged file created -', totalSize, 'MB');
    console.log('[MGX] ==============================================');
    console.log('[MGX] SUCCESS: All 3 stages completed!');
    console.log('[MGX]   Stage 1: Video file -', videoSize, 'MB');
    console.log('[MGX]   Stage 2: Audio file -', audioSize, 'MB');
    console.log('[MGX]   Stage 3: Merged file -', totalSize, 'MB');
    console.log('[MGX] ==============================================');
    
    // ============================================================
    // FINAL: İNDİR
    // ============================================================
    updateProgress(progressDiv, 95, 'Kaydediliyor...');
    
    const url = URL.createObjectURL(mergedFile);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'merged_' + Date.now() + '.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    updateProgress(progressDiv, 100, totalSize + ' MB indirildi (Video:' + videoSize + ' + Audio:' + audioSize + ')', false);
    
    setTimeout(() => progressDiv.remove(), 8000);
    
  } catch (error) {
    console.error('[MGX] Download error:', error);
    updateProgress(progressDiv, 100, 'Hata: ' + error.message, true);
  }
}

function buildFileName(){
  const raw = (document.getElementById('pageTitle')?.textContent || 'video').trim();
  const cleaned = raw.replace(/[^a-z0-9\-_\. ]/gi,'').replace(/\s+/g,'_');
  return (cleaned || 'video') + '_' + Date.now();
}

async function verifyFfmpegCore(){
  const base = chrome.runtime.getURL('ffmpeg/');
  const mandatory = [ 'ffmpeg-core.js','ffmpeg-core.wasm' ];
  const optional = [ 'ffmpeg-core.worker.js' ]; // bazı sürümlerde yok
  const result = { ok:true, core:false, wasm:false, worker:false, message:'' };

  // Zorunlu dosyalar
  for(const f of mandatory){
    try {
      const r = await fetch(base+f, { method:'GET' });
      if(!r.ok){ result.ok=false; result.message = f+' HTTP '+r.status; return result; }
      const len = r.headers.get('content-length');
      if(f==='ffmpeg-core.js') result.core = true;
      if(f==='ffmpeg-core.wasm') result.wasm = true;
      appendLog('[core] '+f+' size='+(len||'?'));
    } catch(e){ result.ok=false; result.message = f+' fetch error: '+e.message; return result; }
  }
  // Opsiyonel worker
  for(const f of optional){
    try {
      const r = await fetch(base+f, { method:'GET' });
      if(r.ok){
        const len = r.headers.get('content-length');
        result.worker = true;
        appendLog('[core] '+f+' size='+(len||'?'));
      } else {
        appendLog('[core] '+f+' yok (opsiyonel)');
      }
    } catch(_){ appendLog('[core] '+f+' erişilemedi (opsiyonel)'); }
  }

  if(!result.core || !result.wasm){ result.ok=false; result.message='Zorunlu ffmpeg core dosyaları eksik'; }
  return result;
}

// ============================================================================
// CREATE M3U8 ITEM
// ============================================================================
function createM3U8Item(m3u8) {
  const item = document.createElement('div');
  item.className = 'media-item m3u8-item';
  item.dataset.url = m3u8.url;
  item.dataset.type = m3u8.type || 'unknown';
  
  const url = new URL(m3u8.url);
  const filename = url.pathname.split('/').pop();
  
  // Type indicator with color
  let typeLabel = 'M3U8';
  let typeColor = '#999';
  let borderColor = '#444';
  
  if (m3u8.type === 'variant') {
    typeLabel = 'VIDEO';
    typeColor = '#fff';
    borderColor = '#fff';
  } else if (m3u8.type === 'audio') {
    typeLabel = 'AUDIO';
    typeColor = '#ccc';
    borderColor = '#888';
  } else if (m3u8.type === 'master') {
    typeLabel = 'MASTER';
    typeColor = '#666';
    borderColor = '#333';
  }
  
  item.style.borderLeft = '3px solid ' + borderColor;
  
  item.innerHTML = '<div class="media-info">' +
    '<div class="media-title" style="display: flex; gap: 8px; align-items: center;">' +
    '<span style="font-size: 9px; padding: 2px 6px; background: #2a2a2a; border-radius: 3px; color: ' + typeColor + ';">' + typeLabel + '</span>' +
    '<span>HLS Stream</span>' +
    '</div>' +
    '<div class="media-subtitle">' + filename + '</div>' +
    '<div class="media-url">' + url.hostname + '</div>' +
    '</div>';
  
  const actions = document.createElement('div');
  actions.className = 'media-actions';
  
  const downloadBtn = createButton('Indir', 'download-btn', () => {
    autoDownloadM3U8(m3u8.url, item);
  });
  
  actions.appendChild(downloadBtn);
  item.appendChild(actions);
  
  return item;
}

// ============================================================================
// AUTO DOWNLOAD M3U8
// ============================================================================
function autoDownloadM3U8(url, itemElement) {
  const btn = itemElement.querySelector('.download-btn');
  btn.textContent = 'Analiz...';
  btn.disabled = true;
  
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: url,
    tabId: currentTabId
  }, (result) => {
    if (result.error) {
      btn.textContent = 'Hata';
      showError(itemElement, result.error);
      return;
    }
    
    // Basit indirme - variant ise indir, master ise yoksay
    if (result.type === 'variant' && result.segments) {
      btn.textContent = 'Indiriliyor...';
      downloadSegmentsBrowser(result.segments, 'video', itemElement);
      
    } else if (result.type === 'master') {
      btn.textContent = 'Master';
      btn.disabled = true;
      btn.style.opacity = '0.3';
      showError(itemElement, 'Master playlist - variant/audio seciniz');
      
    } else {
      btn.textContent = 'Gecersiz';
      showError(itemElement, 'Playlist formati desteklenmiyor');
    }
  });
}

// ============================================================================
// ADD VARIANTS TO MAIN LIST (NOT SUBMENU)
// ============================================================================
function addVariantsToMainList(playlist, masterElement) {
  const mediaList = document.getElementById('mediaList');
  
  // Audio tracks header
  if (playlist.audioTracks && playlist.audioTracks.length > 0) {
    const audioHeader = document.createElement('div');
    audioHeader.style.cssText = 'padding: 8px 15px; background: #2a2a2a; border-bottom: 1px solid #444; font-size: 11px; color: #999; font-weight: 600;';
    audioHeader.textContent = 'SES KANALLARI (' + playlist.audioTracks.length + ')';
    mediaList.insertBefore(audioHeader, masterElement.nextSibling);
    
    // Add each audio track
    playlist.audioTracks.forEach((audio, index) => {
      const audioFilename = audio.uri.split('/').pop().split('?')[0];
      const audioName = audio.name || audio.language || 'Audio ' + (index + 1);
      const isDefault = index === 0;
      
      const audioItem = document.createElement('div');
      audioItem.className = 'media-item';
      audioItem.style.cssText = 'padding: 10px 15px; background: #1a1a1a; border-bottom: 1px solid #333; border-left: 2px solid ' + (isDefault ? '#fff' : '#666') + ';';
      
      const audioInfo = document.createElement('div');
      audioInfo.style.cssText = 'flex: 1;';
      audioInfo.innerHTML = '<div style="font-size: 11px; font-weight: 600; color: #fff; margin-bottom: 3px;">' + audioName + (isDefault ? ' (Varsayilan)' : '') + '</div>' +
        '<div style="font-size: 9px; color: #999;">' + audioFilename + '</div>';
      
      audioItem.appendChild(audioInfo);
      audioHeader.parentNode.insertBefore(audioItem, audioHeader.nextSibling);
    });
  }
  
  // Video variants header
  const variantHeader = document.createElement('div');
  variantHeader.style.cssText = 'padding: 8px 15px; background: #2a2a2a; border-bottom: 1px solid #444; font-size: 11px; color: #999; font-weight: 600; margin-top: 5px;';
  variantHeader.textContent = 'VIDEO KALITELERI (' + playlist.variants.length + ')';
  
  const insertPoint = playlist.audioTracks && playlist.audioTracks.length > 0 
    ? masterElement.nextSibling.nextSibling.nextSibling 
    : masterElement.nextSibling;
  
  mediaList.insertBefore(variantHeader, insertPoint);
  
  // Add each variant with audio selector
  playlist.variants.forEach((variant, index) => {
    const videoFilename = variant.url.split('/').pop().split('?')[0];
    
    const variantItem = document.createElement('div');
    variantItem.className = 'media-item';
    variantItem.style.cssText = 'padding: 10px 15px; background: #1a1a1a; border-bottom: 1px solid #333; display: flex; flex-direction: column; gap: 8px;';
    
    // Video info
    const videoInfo = document.createElement('div');
    videoInfo.innerHTML = '<div style="font-size: 11px; font-weight: 600; color: #fff; margin-bottom: 3px;">' + variant.quality + ' (' + variant.resolution + ')</div>' +
      '<div style="font-size: 9px; color: #999;">' + videoFilename + '</div>';
    variantItem.appendChild(videoInfo);
    
    // Audio selector
    if (playlist.audioTracks && playlist.audioTracks.length > 0) {
      const audioSelector = document.createElement('select');
      audioSelector.className = 'variant-audio-select-' + index;
      audioSelector.style.cssText = 'padding: 5px 8px; background: #2a2a2a; color: #fff; border: 1px solid #555; border-radius: 3px; font-size: 9px;';
      
      playlist.audioTracks.forEach((audio, audioIndex) => {
        const audioName = audio.name || audio.language || 'Audio ' + (audioIndex + 1);
        const audioFile = audio.uri.split('/').pop().split('?')[0];
        const option = document.createElement('option');
        option.value = audioIndex;
        option.textContent = 'Ses: ' + audioName + ' - ' + audioFile;
        audioSelector.appendChild(option);
      });
      
      variantItem.appendChild(audioSelector);
    }
    
    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Indir (Video + Ses)';
    downloadBtn.style.cssText = 'padding: 6px 10px; background: #fff; color: #000; border: none; border-radius: 3px; cursor: pointer; font-size: 10px; font-weight: 600;';
    downloadBtn.onclick = () => {
      let audioTrack = null;
      if (playlist.audioTracks && playlist.audioTracks.length > 0) {
        const audioSelect = variantItem.querySelector('.variant-audio-select-' + index);
        const audioIndex = parseInt(audioSelect.value);
        audioTrack = playlist.audioTracks[audioIndex];
      }
      
      downloadBtn.textContent = 'Indiriliyor...';
      downloadBtn.disabled = true;
      downloadBtn.style.opacity = '0.5';
      downloadBtn.style.cursor = 'not-allowed';
      
      // Status
      const status = document.createElement('div');
      status.style.cssText = 'font-size: 9px; color: #fff; margin-top: 5px;';
      status.textContent = 'Indiriliyor: ' + variant.quality + ' + ' + (audioTrack ? (audioTrack.name || audioTrack.language || 'Audio') : 'Ses yok');
      variantItem.appendChild(status);
      
      downloadVariant(variant, audioTrack, variantItem);
    };
    
    variantItem.appendChild(downloadBtn);
    variantHeader.parentNode.insertBefore(variantItem, variantHeader.nextSibling);
  });
}

// ============================================================================
// DOWNLOAD VARIANT
// ============================================================================
function downloadVariant(variant, audioTrack, itemElement) {
  const progressDiv = createProgressIndicator(itemElement);
  updateProgress(progressDiv, 0, 'Video analiz ediliyor...');
  
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: variant.url,
    tabId: currentTabId
  }, (videoResult) => {
    if (videoResult.error || !videoResult.segments) {
      updateProgress(progressDiv, 100, 'Video hatasi: ' + (videoResult.error || 'Segment bulunamadi'), true);
      return;
    }
    
    const videoSegments = videoResult.segments;
    
    if (audioTrack && audioTrack.uri) {
      updateProgress(progressDiv, 10, 'Audio analiz ediliyor...');
      
      chrome.runtime.sendMessage({
        type: "PARSE_M3U8",
        url: audioTrack.uri,
        tabId: currentTabId
      }, (audioResult) => {
        console.log('[MGX Popup] Audio parse result:', audioResult);
        console.log('[MGX Popup] Audio URI:', audioTrack.uri);
        
        const audioSegments = audioResult?.segments || [];
        
        console.log('[MGX Popup] Video segments: ' + videoSegments.length + ', Audio segments: ' + audioSegments.length);
        
        if (audioSegments.length === 0) {
          console.warn('[MGX Popup] Audio segments empty!');
          updateProgress(progressDiv, 100, 'Audio segment bulunamadi - Sadece video', true);
          downloadSegmentsBrowser(videoSegments, 'video_' + variant.quality, itemElement, progressDiv);
          return;
        }
        
        updateProgress(progressDiv, 20, 'Video: ' + videoSegments.length + ' + Audio: ' + audioSegments.length);
        
        downloadSeparateVideoAudio(videoSegments, audioSegments, variant.quality, itemElement, progressDiv);
      });
    } else {
      updateProgress(progressDiv, 20, 'Video indiriliyor...');
      downloadSegmentsBrowser(videoSegments, 'video_' + variant.quality, itemElement, progressDiv);
    }
  });
}

// ============================================================================
// DOWNLOAD SEPARATE VIDEO AND AUDIO
// ============================================================================
function downloadSeparateVideoAudio(videoSegments, audioSegments, quality, itemElement, progressDiv) {
  console.log('[MGX Popup] downloadSeparateVideoAudio:');
  console.log('  Video segments: ' + videoSegments.length);
  console.log('  Audio segments: ' + audioSegments.length);
  
  updateProgress(progressDiv, 25, 'Birlestiriliyor: ' + videoSegments.length + ' video + ' + audioSegments.length + ' audio');
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      updateProgress(progressDiv, 100, 'Aktif sekme bulunamadi', true);
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "MERGE_VIDEO_AUDIO",
      videoSegments: videoSegments.map(s => s.url),
      audioSegments: audioSegments.map(s => s.url),
      filename: 'video_' + quality + '_' + Date.now()
    }, (response) => {
      if (chrome.runtime.lastError) {
        updateProgress(progressDiv, 100, 'Indirme baslatilamadi', true);
        console.error('[MGX] Content script error:', chrome.runtime.lastError);
      } else {
        updateProgress(progressDiv, 30, 'Islem devam ediyor...');
      }
    });
  });
}

// ============================================================================
// DOWNLOAD SEGMENTS BROWSER
// ============================================================================
function downloadSegmentsBrowser(segments, type, itemElement, existingProgressDiv) {
  const progressDiv = existingProgressDiv || createProgressIndicator(itemElement);
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) return;
    
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "DOWNLOAD_SEGMENTS",
      segments: segments.map(s => s.url),
      filename: type + '_' + Date.now(),
      fileType: type
    });
  });
}

// ============================================================================
// CREATE VIDEO ITEM
// ============================================================================
function createVideoItem(video) {
  const item = document.createElement('div');
  item.className = 'media-item';
  
  const url = new URL(video.url);
  const filename = url.pathname.split('/').pop();
  const ext = video.ext || 'video';
  
  item.innerHTML = '<div class="media-info">' +
    '<div class="media-title">Video (' + ext.toUpperCase() + ')</div>' +
    '<div class="media-subtitle">' + filename + '</div>' +
    '<div class="media-url">' + url.hostname + '</div>' +
    '</div>';
  
  const actions = document.createElement('div');
  actions.className = 'media-actions';
  
  const downloadBtn = createButton('Indir', 'download-btn', () => {
    chrome.downloads.download({
      url: video.url,
      filename: filename
    });
  });
  
  actions.appendChild(downloadBtn);
  item.appendChild(actions);
  
  return item;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function createButton(text, className, onClick) {
  const button = document.createElement('button');
  button.textContent = text;
  button.className = className;
  button.addEventListener('click', onClick);
  return button;
}

function createProgressIndicator(parentElement) {
  const progressDiv = document.createElement('div');
  progressDiv.className = 'progress-indicator';
  progressDiv.innerHTML = '<div class="progress-bar"><div class="progress-fill" style="width: 0%"></div></div>' +
    '<div class="progress-text">Baslatiliyor...</div>';
  parentElement.appendChild(progressDiv);
  return progressDiv;
}

function updateProgress(progressDiv, percentage, text, isError) {
  const fill = progressDiv.querySelector('.progress-fill');
  const textEl = progressDiv.querySelector('.progress-text');
  
  fill.style.width = percentage + '%';
  fill.style.backgroundColor = isError ? '#e74c3c' : '#27ae60';
  textEl.textContent = text;
}

function showError(parentElement, error) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.style.position = 'relative';
  errorDiv.style.paddingRight = '30px';
  errorDiv.textContent = 'Hata: ' + error;
  
  const closeBtn = document.createElement('span');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = 'position: absolute; right: 10px; top: 10px; cursor: pointer; font-weight: bold; font-size: 18px; line-height: 1;';
  closeBtn.onclick = () => errorDiv.remove();
  errorDiv.appendChild(closeBtn);
  
  parentElement.appendChild(errorDiv);
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "DOWNLOAD_PROGRESS") {
    console.log('[MGX Popup] Download Progress:', request.data);
  }
});
