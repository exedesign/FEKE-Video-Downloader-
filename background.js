// ============================================================================
// MGX MEDIA DOWNLOADER - PROFESSIONAL HLS VIDEO DOWNLOADER
// ============================================================================
// Akıllı M3U8 playlist parser ve segment downloader
// Master/Variant/Audio playlist desteği
// FFmpeg ile audio/video birleştirme
// ============================================================================

console.log('[MGX] Professional HLS Downloader initialized');

// ============================================================================
// STORAGE - Detected Media by Tab
// ============================================================================
const detectedMediaByTab = {};

// ============================================================================
// M3U8 YAKALAMA - WebRequest Listener
// ============================================================================
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const { tabId, url } = details;
    if (tabId <= 0) return;

    // Initialize tab storage
    if (!detectedMediaByTab[tabId]) {
      detectedMediaByTab[tabId] = {
        m3u8Files: [],
        videoFiles: [],
        parsedPlaylists: {}
      };
    }

    // M3U8 playlist yakalama
    if (/\.m3u8(\?.*)?$/i.test(url)) {
      console.log(`[MGX] 🎬 M3U8 Captured: ${url}`);
      addM3U8File(tabId, url);
    }
    // Direkt video dosyaları (MP4, WebM, vb.)
    else if (/\.(mp4|webm|avi|mov|mkv)(\?.*)?$/i.test(url)) {
      console.log(`[MGX] 📹 Video Captured: ${url}`);
      addVideoFile(tabId, url);
    }
  },
  { urls: ["<all_urls>"] },
  []
);

// ============================================================================
// M3U8 FILE HANDLER
// ============================================================================
function addM3U8File(tabId, url) {
  const tab = detectedMediaByTab[tabId];
  
  // Duplicate kontrolü
  if (tab.m3u8Files.some(f => f.url === url)) return;
  
  const filename = url.split('/').pop().split('?')[0].toLowerCase();
  
  // TÜM M3U8'leri popup'ta göster - filtreleme yok!
  const isVariant = filename.includes('variant') || filename.match(/\d{3,4}p/); // 720p, 1080p gibi
  const isAudio = filename.includes('audio') || filename.includes('sound') || filename.includes('snd');
  
  const fileType = isVariant ? 'variant' : (isAudio ? 'audio' : 'master');
  
  console.log(`[MGX] Detected M3U8: ${filename} (Type: ${fileType})`);
  
  // HEPSİNİ EKLE - master, variant, audio hepsi popup'ta görünsün
  tab.m3u8Files.push({
    url: url,
    timestamp: Date.now(),
    type: fileType,
    parsed: false
  });
  
  updateBadge(tabId);
}

// ============================================================================
// REGULAR VIDEO FILE HANDLER
// ============================================================================
function addVideoFile(tabId, url) {
  const tab = detectedMediaByTab[tabId];
  
  if (tab.videoFiles.some(f => f.url === url)) return;
  
  // Sahte/Yanıltıcı dosyaları filtrele
  const filename = url.split('/').pop().split('?')[0].toLowerCase();
  const fakePatterns = ['blank', 'dummy', 'placeholder', 'empty', 'fake', 'test', 'sample'];
  
  if (fakePatterns.some(pattern => filename.includes(pattern))) {
    console.log(`[MGX] Filtering fake video: ${filename}`);
    return;
  }
  
  // Çok küçük dosyalar (genelde < 100KB sahte dosyalardır)
  // Bu kontrolü HEAD request ile yapabiliriz ama şimdilik isim kontrolü yeterli
  
  const ext = url.match(/\.([a-z0-9]+)(\?|$)/i);
  tab.videoFiles.push({
    url: url,
    type: ext ? ext[1].toLowerCase() : 'unknown',
    timestamp: Date.now()
  });
  
  updateBadge(tabId);
}

// ============================================================================
// BADGE UPDATE
// ============================================================================
function updateBadge(tabId) {
  const tab = detectedMediaByTab[tabId];
  if (!tab) return;
  
  const count = tab.m3u8Files.length + tab.videoFiles.length;
  
  if (count > 0) {
    chrome.action.setBadgeText({ text: count.toString(), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#e74c3c', tabId });
  }
}

// ============================================================================
// M3U8 PARSER - Professional 3-Level Parser
// ============================================================================
async function parseM3U8Playlist(url) {
  try {
    console.log(`[MGX Parser] Fetching M3U8: ${url}`);
    
    const response = await fetch(url);
    const content = await response.text();
    
    console.log(`[MGX Parser] Content fetched (${content.length} bytes)`);
    
    // Playlist tipini belirle - URL'yi de gönder
    const playlistType = determinePlaylistType(content, url);
    console.log(`[MGX Parser] Playlist Type: ${playlistType} (URL: ${url})`);
    
    switch (playlistType) {
      case 'master':
        return parseMasterPlaylist(url, content);
      case 'variant':
        return parseVariantPlaylist(url, content);
      case 'audio':
        // Audio da aynı segment parse mantığını kullan, sadece type farklı
        const audioResult = parseVariantPlaylist(url, content);
        audioResult.type = 'audio';
        console.log(`[MGX Parser] Audio playlist parsed as variant with type override`);
        return audioResult;
      default:
        throw new Error('Unknown playlist type');
    }
  } catch (error) {
    console.error('[MGX Parser] Error:', error);
    return { error: error.message };
  }
}

// ============================================================================
// DETERMINE PLAYLIST TYPE
// ============================================================================
function determinePlaylistType(content, url = '') {
  // Master Playlist: Contains EXT-X-STREAM-INF (multiple quality variants)
  if (content.includes('#EXT-X-STREAM-INF')) {
    return 'master';
  }
  
  // Audio Playlist: Contains .aac, .m4a segments OR audio in URL
  if (/\.aac|\.m4a/i.test(content) || /audio|sound|snd/i.test(url)) {
    return 'audio';
  }
  
  // Variant Playlist: Contains .ts segments
  if (/\.ts(\?|$)/im.test(content)) {
    return 'variant';
  }
  
  return 'unknown';
}

// ============================================================================
// PARSE MASTER PLAYLIST (Multiple Quality Variants)
// ============================================================================
function parseMasterPlaylist(url, content) {
  const result = {
    type: 'master',
    url: url,
    variants: [],
    audioTracks: []
  };
  
  const lines = content.split('\n').map(l => l.trim());
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Audio tracks
    if (line.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
      const audioTrack = {
        type: 'audio',
        groupId: extractAttribute(line, 'GROUP-ID'),
        name: extractAttribute(line, 'NAME'),
        language: extractAttribute(line, 'LANGUAGE'),
        uri: extractAttribute(line, 'URI'),
        default: line.includes('DEFAULT=YES')
      };
      
      if (audioTrack.uri) {
        audioTrack.uri = resolveUrl(url, audioTrack.uri);
        result.audioTracks.push(audioTrack);
      }
    }
    
    // Video variants
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const bandwidth = extractAttribute(line, 'BANDWIDTH');
      const resolution = extractAttribute(line, 'RESOLUTION');
      const frameRate = extractAttribute(line, 'FRAME-RATE');
      const codecs = extractAttribute(line, 'CODECS');
      const audioGroup = extractAttribute(line, 'AUDIO');
      
      // Next line contains the variant URL
      const variantUrl = lines[i + 1];
      if (variantUrl && !variantUrl.startsWith('#')) {
        result.variants.push({
          url: resolveUrl(url, variantUrl),
          bandwidth: parseInt(bandwidth) || 0,
          resolution: resolution || 'unknown',
          frameRate: parseFloat(frameRate) || 0,
          codecs: codecs,
          audioGroup: audioGroup,
          quality: extractQualityFromResolution(resolution)
        });
      }
    }
  }
  
  // Sort variants by bandwidth (highest first)
  result.variants.sort((a, b) => b.bandwidth - a.bandwidth);
  
  console.log(`[MGX Parser] Master: ${result.variants.length} variants, ${result.audioTracks.length} audio tracks`);
  console.log('[MGX Parser] Variants:', result.variants.map(v => `${v.quality} → ${v.url}`));
  console.log('[MGX Parser] Audio Tracks:', result.audioTracks.map(a => `${a.name || a.language} → ${a.uri}`));
  
  return result;
}

// ============================================================================
// PARSE VARIANT PLAYLIST (Single Quality - TS Segments)
// ============================================================================
function parseVariantPlaylist(url, content) {
  const result = {
    type: 'variant',
    url: url,
    segments: [],
    totalDuration: 0
  };
  
  const lines = content.split('\n').map(l => l.trim());
  const basePath = url.substring(0, url.lastIndexOf('/') + 1);
  
  let currentDuration = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Segment duration
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      if (match) {
        currentDuration = parseFloat(match[1]);
      }
    }
    
    // Segment URL
    if (line && !line.startsWith('#')) {
      result.segments.push({
        url: resolveUrl(url, line),
        duration: currentDuration
      });
      result.totalDuration += currentDuration;
      currentDuration = 0;
    }
  }
  
  console.log(`[MGX Parser] Variant: ${result.segments.length} segments, ${Math.round(result.totalDuration)}s`);
  
  return result;
}

// ============================================================================
// PARSE AUDIO PLAYLIST (.aac segments)
// ============================================================================
function parseAudioPlaylist(url, content) {
  const result = {
    type: 'audio',
    url: url,
    segments: [],
    totalDuration: 0
  };
  
  const lines = content.split('\n').map(l => l.trim());
  let currentDuration = 0;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      if (match) {
        currentDuration = parseFloat(match[1]);
      }
    }
    
    if (line && !line.startsWith('#')) {
      result.segments.push({
        url: resolveUrl(url, line),
        duration: currentDuration
      });
      result.totalDuration += currentDuration;
      currentDuration = 0;
    }
  }
  
  console.log(`[MGX Parser] Audio: ${result.segments.length} segments, ${Math.round(result.totalDuration)}s`);
  
  return result;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
function extractAttribute(line, attr) {
  const regex = new RegExp(`${attr}="([^"]+)"`, 'i');
  const match = line.match(regex);
  if (match) return match[1];
  
  // Try without quotes
  const regex2 = new RegExp(`${attr}=([^,\\s]+)`, 'i');
  const match2 = line.match(regex2);
  return match2 ? match2[1] : null;
}

function resolveUrl(baseUrl, relativeUrl) {
  if (relativeUrl.startsWith('http://') || relativeUrl.startsWith('https://')) {
    return relativeUrl;
  }
  
  const base = baseUrl.substring(0, baseUrl.lastIndexOf('/') + 1);
  return base + relativeUrl;
}

function extractQualityFromResolution(resolution) {
  if (!resolution) return 'unknown';
  
  const match = resolution.match(/\d+x(\d+)/);
  if (!match) return resolution;
  
  const height = parseInt(match[1]);
  
  if (height >= 2160) return '4K';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  
  return `${height}p`;
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  
  // Get media files for popup
  if (request.type === "GET_MEDIA_FILES") {
    const tabId = request.tabId;
    const tab = detectedMediaByTab[tabId] || { m3u8Files: [], videoFiles: [] };
    
    sendResponse({
      m3u8Files: tab.m3u8Files,
      videoFiles: tab.videoFiles
    });
    return true;
  }
  
  // Parse M3U8 playlist
  if (request.type === "PARSE_M3U8") {
    parseM3U8Playlist(request.url).then(result => {
      // Cache the result
      const tabId = request.tabId;
      if (detectedMediaByTab[tabId]) {
        detectedMediaByTab[tabId].parsedPlaylists[request.url] = result;
      }
      sendResponse(result);
    }).catch(error => {
      sendResponse({ error: error.message });
    });
    return true;
  }
  
  return true;
});

// ============================================================================
// TAB CLEANUP
// ============================================================================
chrome.tabs.onRemoved.addListener((tabId) => {
  delete detectedMediaByTab[tabId];
});
