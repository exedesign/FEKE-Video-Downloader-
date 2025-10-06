// ============================================================================
// MGX MEDIA DOWNLOADER - POPUP UI
// ============================================================================
console.log('[MGX Popup] Initialized');

let currentTabId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadMediaFiles();
  
  // Auto-refresh every 3 seconds
  setInterval(loadMediaFiles, 3000);
});

// ============================================================================
// LOAD MEDIA FILES
// ============================================================================
function loadMediaFiles() {
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) return;
    
    currentTabId = tabs[0].id;
    
    chrome.runtime.sendMessage({
      type: "GET_MEDIA_FILES",
      tabId: currentTabId
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[MGX Popup] Error:', chrome.runtime.lastError);
        return;
      }
      
      displayMediaFiles(response);
    });
  });
}

// ============================================================================
// DISPLAY MEDIA FILES
// ============================================================================
function displayMediaFiles(data) {
  const container = document.getElementById('mediaList');
  const emptyMessage = document.getElementById('emptyMessage');
  
  // Clear existing content
  container.innerHTML = '';
  
  const totalFiles = (data.m3u8Files?.length || 0) + (data.videoFiles?.length || 0);
  
  if (totalFiles === 0) {
    emptyMessage.style.display = 'block';
    return;
  }
  
  emptyMessage.style.display = 'none';
  
  // Display M3U8 files
  if (data.m3u8Files && data.m3u8Files.length > 0) {
    data.m3u8Files.forEach(m3u8 => {
      container.appendChild(createM3U8Item(m3u8));
    });
  }
  
  // Display regular video files
  if (data.videoFiles && data.videoFiles.length > 0) {
    data.videoFiles.forEach(video => {
      container.appendChild(createVideoItem(video));
    });
  }
}

// ============================================================================
// CREATE M3U8 ITEM
// ============================================================================
function createM3U8Item(m3u8) {
  const item = document.createElement('div');
  item.className = 'media-item m3u8-item';
  
  const icon = document.createElement('div');
  icon.className = 'media-icon';
  icon.textContent = '🎬';
  
  const info = document.createElement('div');
  info.className = 'media-info';
  
  const url = new URL(m3u8.url);
  const filename = url.pathname.split('/').pop();
  
  info.innerHTML = `
    <div class="media-title">📡 HLS Stream (M3U8)</div>
    <div class="media-subtitle">${filename}</div>
    <div class="media-url">${url.hostname}</div>
  `;
  
  const actions = document.createElement('div');
  actions.className = 'media-actions';
  
  // Direct download button
  const downloadBtn = createButton('⬇️ İndir', 'download-btn', () => {
    autoDownloadM3U8(m3u8.url, item);
  });
  
  actions.appendChild(downloadBtn);
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  return item;
}

// ============================================================================
// AUTO DOWNLOAD M3U8 (Best Quality)
// ============================================================================
function autoDownloadM3U8(url, itemElement) {
  const btn = itemElement.querySelector('.download-btn');
  btn.textContent = '⏳ Analiz ediliyor...';
  btn.disabled = true;
  
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: url,
    tabId: currentTabId
  }, (result) => {
    if (result.error) {
      btn.textContent = '❌ Hata';
      showError(itemElement, result.error);
      return;
    }
    
    if (result.type === 'master' && result.variants && result.variants.length > 0) {
      // Master playlist - en iyi kaliteyi otomatik seç
      const bestVariant = result.variants.reduce((prev, current) => {
        return (current.bandwidth > prev.bandwidth) ? current : prev;
      });
      
      const audioTrack = result.audioTracks && result.audioTracks.length > 0 
        ? result.audioTracks[0] 
        : null;
      
      btn.textContent = `⏳ ${bestVariant.quality} indiriliyor...`;
      
      // Show quality info
      const infoDiv = document.createElement('div');
      infoDiv.className = 'download-info';
      infoDiv.innerHTML = `
        <div style="margin: 10px 0; padding: 10px; background: rgba(255,255,255,0.1); border-radius: 6px; font-size: 12px;">
          📹 Kalite: ${bestVariant.quality} (${bestVariant.resolution})<br>
          🔊 Ses: ${audioTrack ? (audioTrack.language || audioTrack.name) : 'Yok'}<br>
          ⏬ İndirme başlatıldı...
        </div>
      `;
      itemElement.appendChild(infoDiv);
      
      // Otomatik indir
      downloadVariant(bestVariant, audioTrack, itemElement);
      
    } else if (result.type === 'variant' && result.segments) {
      // Direkt variant playlist - segmentleri indir
      btn.textContent = '⏳ İndiriliyor...';
      downloadSegmentsBrowser(result.segments, 'video', itemElement);
      
    } else {
      btn.textContent = '❌ Geçersiz';
      showError(itemElement, 'Playlist formatı desteklenmiyor');
    }
  });
}

// ============================================================================
// ANALYZE M3U8 (Manual Analysis - Deprecated)
// ============================================================================
function analyzeM3U8(url, itemElement) {
  const btn = itemElement.querySelector('.analyze-btn');
  btn.textContent = '⏳ Analiz ediliyor...';
  btn.disabled = true;
  
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: url,
    tabId: currentTabId
  }, (result) => {
    btn.remove();
    
    if (result.error) {
      showError(itemElement, result.error);
      return;
    }
    
    showPlaylistDetails(itemElement, result);
  });
}

// ============================================================================
// SHOW PLAYLIST DETAILS
// ============================================================================
function showPlaylistDetails(itemElement, playlist) {
  const details = document.createElement('div');
  details.className = 'playlist-details';
  
  if (playlist.type === 'master') {
    // Master playlist with multiple qualities
    details.innerHTML = `
      <div class="detail-header">
        <strong>🎯 Çoklu Kalite Seçenekleri</strong>
        <span class="badge">${playlist.variants.length} kalite</span>
      </div>
    `;
    
    // Quality options
    const variantList = document.createElement('div');
    variantList.className = 'variant-list';
    
    playlist.variants.forEach((variant, index) => {
      const variantItem = document.createElement('div');
      variantItem.className = 'variant-item';
      
      const qualityBadge = document.createElement('span');
      qualityBadge.className = 'quality-badge';
      qualityBadge.textContent = variant.quality;
      
      const variantInfo = document.createElement('div');
      variantInfo.className = 'variant-info';
      
      // Variant ve Audio URL'lerini göster
      const audioTrack = playlist.audioTracks && playlist.audioTracks.length > 0 
        ? playlist.audioTracks[0] 
        : null;
      
      const videoFilename = variant.url.split('/').pop().split('?')[0];
      const audioFilename = audioTrack ? audioTrack.uri.split('/').pop().split('?')[0] : '';
      const fpsText = variant.frameRate ? '<div class="small-text">' + variant.frameRate + ' fps</div>' : '';
      const audioHTML = audioTrack 
        ? '<div class="playlist-url-item">� <span class="url-label">Audio:</span> <code class="url-text">' + audioFilename + '</code></div>'
        : '<div class="playlist-url-item disabled">🔇 Audio yok</div>';
      
      variantInfo.innerHTML = 
        '<div class="variant-main">' + variant.resolution + ' • ' + (variant.bandwidth / 1000000).toFixed(1) + ' Mbps</div>' +
        fpsText +
        '<div class="playlist-urls">' +
          '<div class="playlist-url-item">📹 <span class="url-label">Video:</span> <code class="url-text">' + videoFilename + '</code></div>' +
          audioHTML +
        '</div>';
      `;
      
      const analyzeBtn = createButton('🔍 Analiz Et', 'analyze-variant-btn', () => {
        const audioTrack = playlist.audioTracks && playlist.audioTracks.length > 0 
          ? playlist.audioTracks[0] 
          : null;
        
        console.log('[MGX Popup] Analyze clicked:');
        console.log('  - Variant:', variant.quality, variant.url);
        console.log('  - Audio tracks available:', playlist.audioTracks?.length || 0);
        console.log('  - Selected audio track:', audioTrack);
        
        analyzeVariantSegments(variant, audioTrack, variantItem);
      });
      
      variantItem.appendChild(qualityBadge);
      variantItem.appendChild(variantInfo);
      variantItem.appendChild(analyzeBtn);
      
      variantList.appendChild(variantItem);
    });
    
    details.appendChild(variantList);
    
    // Audio tracks - Detaylı Gösterim
    if (playlist.audioTracks && playlist.audioTracks.length > 0) {
      const audioHeader = document.createElement('div');
      audioHeader.className = 'detail-header';
      audioHeader.innerHTML = '<strong>Ses Kanallari</strong><span class="badge">' + playlist.audioTracks.length + ' kanal</span>';
      details.appendChild(audioHeader);
      
      const audioList = document.createElement('div');
      audioList.className = 'audio-list';
      
      playlist.audioTracks.forEach((audio, index) => {
        const audioItem = document.createElement('div');
        audioItem.className = 'audio-item';
        
        const audioIcon = document.createElement('span');
        audioIcon.className = 'audio-icon';
        audioIcon.textContent = '🎵';
        
        const audioDetails = document.createElement('div');
        audioDetails.className = 'audio-details';
        
        const audioName = audio.name || audio.language || 'Audio ' + (index + 1);
        const audioLang = audio.language ? '(' + audio.language.toUpperCase() + ')' : '';
        const audioChannels = audio.channels ? audio.channels + 'ch' : '';
        
        let audioHTML = '<div class="audio-name">' + audioName + ' ' + audioLang + '</div>';
        audioHTML += '<div class="audio-meta">';
        if (audioChannels) {
          audioHTML += '<span class="audio-badge">' + audioChannels + '</span>';
        }
        if (audio.groupId) {
          audioHTML += '<span class="audio-badge">' + audio.groupId + '</span>';
        }
        if (audio.default) {
          audioHTML += '<span class="audio-badge default-badge">Varsayılan</span>';
        }
        audioHTML += '</div>';
        
        audioDetails.innerHTML = audioHTML;
        
        audioItem.appendChild(audioIcon);
        audioItem.appendChild(audioDetails);
        audioList.appendChild(audioItem);
      });
      
      details.appendChild(audioList);
    }
    
  } else if (playlist.type === 'variant') {
    // Single quality variant
    details.innerHTML = `
      <div class="detail-header">
        <strong>📹 Video Stream</strong>
        <span class="badge">${playlist.segments.length} segments</span>
      </div>
      <div class="stream-info">
        <div>⏱️ Süre: ${formatDuration(playlist.totalDuration)}</div>
        <div>📊 Segment Sayısı: ${playlist.segments.length}</div>
      </div>
    `;
    
    const downloadOptions = document.createElement('div');
    downloadOptions.className = 'download-options';
    
    // Direct download button
    const downloadBtn = createButton('⬇️ İndir', 'download-btn', () => {
      downloadSegmentsBrowser(playlist.segments, 'video', itemElement);
    });
    
    downloadOptions.appendChild(downloadBtn);
    details.appendChild(downloadOptions);
    
  } else if (playlist.type === 'audio') {
    // Audio-only stream
    details.innerHTML = `
      <div class="detail-header">
        <strong>🔊 Audio Stream</strong>
        <span class="badge">${playlist.segments.length} segments</span>
      </div>
      <div class="stream-info">
        <div>⏱️ Süre: ${formatDuration(playlist.totalDuration)}</div>
        <div>📊 Segment Sayısı: ${playlist.segments.length}</div>
      </div>
    `;
    
    const downloadBtn = createButton('⬇️ Audio İndir', 'audio-download-btn', () => {
      downloadSegmentsBrowser(playlist.segments, 'audio', itemElement);
    });
    
    details.appendChild(downloadBtn);
  }
  
  itemElement.appendChild(details);
}

// ============================================================================
// ANALYZE VARIANT SEGMENTS (Show Video + Audio Details)
// ============================================================================
function analyzeVariantSegments(variant, audioTrack, variantItemElement) {
  const analyzeBtn = variantItemElement.querySelector('.analyze-variant-btn');
  analyzeBtn.textContent = '⏳ Analiz...';
  analyzeBtn.disabled = true;
  
  // Parse video segments
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: variant.url,
    tabId: currentTabId
  }, (videoResult) => {
    if (videoResult.error || !videoResult.segments) {
      analyzeBtn.textContent = '❌ Hata';
      showError(variantItemElement, 'Video segment parse hatası');
      return;
    }
    
    const videoSegments = videoResult.segments;
    
    // If audio track exists, parse it too
    if (audioTrack && audioTrack.uri) {
      chrome.runtime.sendMessage({
        type: "PARSE_M3U8",
        url: audioTrack.uri,
        tabId: currentTabId
      }, (audioResult) => {
        const audioSegments = audioResult?.segments || [];
        
        // Show segment details
        showSegmentAnalysis(variantItemElement, videoSegments, audioSegments, variant, audioTrack);
        analyzeBtn.remove();
      });
    } else {
      // Only video, no audio
      showSegmentAnalysis(variantItemElement, videoSegments, [], variant, null);
      analyzeBtn.remove();
    }
  });
}

// ============================================================================
// SHOW SEGMENT ANALYSIS (Video + Audio Segment Lists)
// ============================================================================
function showSegmentAnalysis(parentElement, videoSegments, audioSegments, variant, audioTrack) {
  const analysisDiv = document.createElement('div');
  analysisDiv.className = 'segment-analysis';
  
  const hasAudio = audioSegments.length > 0;
  const videoDuration = Math.round(videoSegments.reduce((sum, s) => sum + s.duration, 0));
  const audioDuration = hasAudio ? Math.round(audioSegments.reduce((sum, s) => sum + s.duration, 0)) : 0;
  
  let html = '<div class="analysis-header"><strong>Segment Analizi</strong></div>';
  
  html += '<div class="segment-info-grid">';
  
  // Video card
  html += '<div class="segment-info-card">';
  html += '<div class="segment-info-icon">📹</div>';
  html += '<div class="segment-info-content">';
  html += '<div class="segment-info-label">Video Segmentleri</div>';
  html += '<div class="segment-info-value">' + videoSegments.length + ' adet</div>';
  html += '<div class="segment-info-detail">' + videoDuration + 's</div>';
  html += '</div></div>';
  
  // Audio card
  if (hasAudio) {
    html += '<div class="segment-info-card">';
    html += '<div class="segment-info-icon">🔊</div>';
    html += '<div class="segment-info-content">';
    html += '<div class="segment-info-label">Audio Segmentleri</div>';
    html += '<div class="segment-info-value">' + audioSegments.length + ' adet</div>';
    html += '<div class="segment-info-detail">' + audioDuration + 's</div>';
    html += '</div></div>';
  } else {
    html += '<div class="segment-info-card disabled">';
    html += '<div class="segment-info-icon">🔇</div>';
    html += '<div class="segment-info-content">';
    html += '<div class="segment-info-label">Audio Yok</div>';
    html += '<div class="segment-info-value">0 adet</div>';
    html += '</div></div>';
  }
  
  html += '</div>'; // close grid
  
  // Merge info
  html += '<div class="merge-info"><div class="merge-method">';
  html += '<strong>Birleştirme:</strong><div class="method-description">';
  if (hasAudio) {
    html += 'Interleaved: <code>[V1,A1,V2,A2...]</code>';
  } else {
    html += 'Sadece video';
  }
  html += '</div></div></div>';
  
  // Download button
  html += '<div class="download-actions">';
  html += '<button class="merge-download-btn">';
  html += 'Birleştir ve İndir (' + (hasAudio ? 'Video + Audio' : 'Sadece Video') + ')';
  html += '</button></div>';
  
  analysisDiv.innerHTML = html;
  
  parentElement.appendChild(analysisDiv);
  
  // Merge and download button
  const mergeBtn = analysisDiv.querySelector('.merge-download-btn');
  mergeBtn.addEventListener('click', () => {
    mergeBtn.disabled = true;
    mergeBtn.textContent = 'İndiriliyor...';
    downloadSeparateVideoAudio(videoSegments, audioSegments, variant.quality, parentElement, null);
  });
}

// ============================================================================
// DOWNLOAD VARIANT (Video + Audio Separate Files)
// ============================================================================
function downloadVariant(variant, audioTrack, itemElement) {
  const progressDiv = createProgressIndicator(itemElement);
  updateProgress(progressDiv, 0, 'Video analiz ediliyor...');
  
  // Parse video variant
  chrome.runtime.sendMessage({
    type: "PARSE_M3U8",
    url: variant.url,
    tabId: currentTabId
  }, (videoResult) => {
    if (videoResult.error || !videoResult.segments) {
      updateProgress(progressDiv, 100, `❌ Video hatası: ${videoResult.error || 'Segment bulunamadı'}`, true);
      return;
    }
    
    const videoSegments = videoResult.segments;
    
    // Eğer audio track varsa, kullanıcıya seçenek sun
    if (audioTrack && audioTrack.uri) {
      updateProgress(progressDiv, 10, 'Audio analiz ediliyor...');
      
      chrome.runtime.sendMessage({
        type: "PARSE_M3U8",
        url: audioTrack.uri,
        tabId: currentTabId
      }, (audioResult) => {
        console.log('════════════════════════════════════════');
        console.log('[MGX Popup] AUDIO PARSE RESULT:');
        console.log('  URI:', audioTrack.uri);
        console.log('  Result:', audioResult);
        console.log('  Type:', audioResult?.type);
        console.log('  Segments:', audioResult?.segments);
        console.log('  Segment count:', audioResult?.segments?.length || 0);
        console.log('════════════════════════════════════════');
        
        const audioSegments = audioResult?.segments || [];
        
        console.log(`[MGX Popup] 📊 SUMMARY: Video=${videoSegments.length}, Audio=${audioSegments.length}`);
        
        if (audioSegments.length === 0) {
          console.error('[MGX Popup] ❌ AUDIO SEGMENTS EMPTY!');
          console.error('  - Audio M3U8 parse başarısız');
          console.error('  - Sadece video indiriliyor');
          updateProgress(progressDiv, 100, '⚠️ Audio segment bulunamadı - Sadece video indiriliyor', true);
          downloadSegmentsBrowser(videoSegments, `video_${variant.quality}`, itemElement, progressDiv);
          return;
        }
        
        console.log('[MGX Popup] ✅ Audio segments found! Calling merge...');
        updateProgress(progressDiv, 20, `📹 ${videoSegments.length} video + 🔊 ${audioSegments.length} audio`);
        
        // İki ayrı dosya olarak indir
        downloadSeparateVideoAudio(videoSegments, audioSegments, variant.quality, itemElement, progressDiv);
      });
    } else {
      // Sadece video indir
      updateProgress(progressDiv, 20, 'Video indiriliyor...');
      downloadSegmentsBrowser(videoSegments, `video_${variant.quality}`, itemElement, progressDiv);
    }
  });
}

// ============================================================================
// DOWNLOAD SEPARATE VIDEO AND AUDIO
// ============================================================================
function downloadSeparateVideoAudio(videoSegments, audioSegments, quality, itemElement, progressDiv) {
  updateProgress(progressDiv, 25, '� FFmpeg.wasm ile birleştiriliyor...');
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      updateProgress(progressDiv, 100, '❌ Aktif sekme bulunamadı', true);
      return;
    }
    
    // FFmpeg.wasm ile birleştir
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "MERGE_VIDEO_AUDIO",
      videoSegments: videoSegments.map(s => s.url),
      audioSegments: audioSegments.map(s => s.url),
      filename: `video_${quality}_${Date.now()}`
    }, (response) => {
      if (chrome.runtime.lastError) {
        updateProgress(progressDiv, 100, '❌ İndirme başlatılamadı', true);
        console.error('[MGX] Content script error:', chrome.runtime.lastError);
      } else {
        updateProgress(progressDiv, 30, '⏳ İşlem devam ediyor...');
        
        // Show info
        const infoDiv = document.createElement('div');
        infoDiv.style.cssText = 'margin-top: 10px; padding: 10px; background: rgba(52, 152, 219, 0.2); border-radius: 6px; font-size: 11px;';
        infoDiv.innerHTML = `
          ⚙️ FFmpeg.wasm ile birleştirme yapılıyor...<br>
          📹 Video + 🔊 Audio → 🎬 MP4<br>
          <br>
          <div style="opacity: 0.7;">İlerleme sağ üst köşede gösteriliyor...</div>
        `;
        itemElement.appendChild(infoDiv);
      }
    });
  });
}

// ============================================================================
// DOWNLOAD VIDEO WITH AUDIO (DEPRECATED)
// ============================================================================
function downloadVideoWithAudio(videoSegments, audioSegments, quality, itemElement, progressDiv) {
  updateProgress(progressDiv, 15, 'İndirme başlatılıyor...');
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      updateProgress(progressDiv, 100, '❌ Aktif sekme bulunamadı', true);
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "MERGE_VIDEO_AUDIO",
      videoSegments: videoSegments.map(s => s.url),
      audioSegments: audioSegments.map(s => s.url),
      filename: `video_${quality}_${Date.now()}`
    }, (response) => {
      if (chrome.runtime.lastError) {
        updateProgress(progressDiv, 100, '❌ İndirme başlatılamadı', true);
        console.error('[MGX] Content script error:', chrome.runtime.lastError);
      } else {
        updateProgress(progressDiv, 20, 'Segmentler indiriliyor...');
      }
    });
  });
}

// ============================================================================
// DOWNLOAD SEGMENTS IN BROWSER
// ============================================================================
function downloadSegmentsBrowser(segments, type, itemElement, existingProgressDiv) {
  const progressDiv = existingProgressDiv || createProgressIndicator(itemElement);
  updateProgress(progressDiv, 0, `${segments.length} segment indiriliyor...`);
  
  chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
    if (!tabs[0]) {
      updateProgress(progressDiv, 100, '❌ Aktif sekme bulunamadı', true);
      return;
    }
    
    chrome.tabs.sendMessage(tabs[0].id, {
      type: "MERGE_SEGMENTS",
      segments: segments.map(s => s.url),
      filename: `${type}_${Date.now()}`
    }, (response) => {
      if (chrome.runtime.lastError) {
        updateProgress(progressDiv, 100, '❌ İndirme başlatılamadı', true);
        console.error('[MGX] Content script error:', chrome.runtime.lastError);
      } else {
        updateProgress(progressDiv, 20, 'Segmentler indiriliyor...');
      }
    });
  });
}



// ============================================================================
// CREATE VIDEO ITEM (Regular MP4, etc.)
// ============================================================================
function createVideoItem(video) {
  const item = document.createElement('div');
  item.className = 'media-item';
  
  const icon = document.createElement('div');
  icon.className = 'media-icon';
  icon.textContent = '📹';
  
  const info = document.createElement('div');
  info.className = 'media-info';
  
  const url = new URL(video.url);
  const filename = url.pathname.split('/').pop();
  
  info.innerHTML = `
    <div class="media-title">${video.type.toUpperCase()} Video</div>
    <div class="media-subtitle">${filename}</div>
    <div class="media-url">${url.hostname}</div>
  `;
  
  const actions = document.createElement('div');
  actions.className = 'media-actions';
  
  const downloadBtn = createButton('⬇️ İndir', 'download-btn', () => {
    chrome.downloads.download({ url: video.url });
  });
  
  actions.appendChild(downloadBtn);
  
  item.appendChild(icon);
  item.appendChild(info);
  item.appendChild(actions);
  
  return item;
}

// ============================================================================
// UI HELPERS
// ============================================================================
function createButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.className = className;
  btn.addEventListener('click', onClick);
  return btn;
}

function createProgressIndicator(parentElement) {
  const progressDiv = document.createElement('div');
  progressDiv.className = 'progress-indicator';
  progressDiv.innerHTML = `
    <div class="progress-bar">
      <div class="progress-fill" style="width: 0%"></div>
    </div>
    <div class="progress-text">Başlatılıyor...</div>
  `;
  parentElement.appendChild(progressDiv);
  return progressDiv;
}

function updateProgress(progressDiv, percentage, text, isError = false) {
  const fill = progressDiv.querySelector('.progress-fill');
  const textEl = progressDiv.querySelector('.progress-text');
  
  fill.style.width = percentage + '%';
  fill.style.backgroundColor = isError ? '#e74c3c' : '#27ae60';
  textEl.textContent = text;
}

function showError(parentElement, error) {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error-message';
  errorDiv.textContent = '❌ ' + error;
  parentElement.appendChild(errorDiv);
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// LISTEN FOR DOWNLOAD PROGRESS
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "DOWNLOAD_PROGRESS") {
    console.log('[MGX Popup] Download Progress:', request.data);
    // Update progress UI if needed
  }
});
