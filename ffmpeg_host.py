#!/usr/bin/env python3
"""
MGX MediaDownloader - FFmpeg Native Messaging Host
TS segment dosyalarını FFmpeg ile birleştiren native host
"""

import json
import sys
import os
import subprocess
import tempfile
import struct
import threading
from pathlib import Path

# Native messaging için message gönderme/alma fonksiyonları
def send_message(message):
    """Chrome extension'a message gönder"""
    message_str = json.dumps(message)
    message_bytes = message_str.encode('utf-8')
    sys.stdout.buffer.write(struct.pack('<I', len(message_bytes)))
    sys.stdout.buffer.write(message_bytes)
    sys.stdout.buffer.flush()

def read_message():
    """Chrome extension'dan message oku"""
    raw_length = sys.stdin.buffer.read(4)
    if not raw_length:
        return None
    message_length = struct.unpack('<I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

def find_ffmpeg():
    """FFmpeg binary dosyasını bul"""
    # Önce extension klasöründe ara
    extension_dir = Path(__file__).parent
    ffmpeg_path = extension_dir / "ffmpeg.exe"
    
    if ffmpeg_path.exists():
        return str(ffmpeg_path)
    
    # PATH'te ara
    try:
        result = subprocess.run(['where', 'ffmpeg'], capture_output=True, text=True, shell=True)
        if result.returncode == 0:
            return result.stdout.strip().split('\n')[0]
    except:
        pass
    
    return None

def download_segments(segments, output_dir, progress_callback=None):
    """TS segmentlerini indir"""
    import urllib.request
    import urllib.error
    
    downloaded_files = []
    failed_count = 0
    
    for i, segment_url in enumerate(segments):
        try:
            filename = f"segment_{i:04d}.ts"
            filepath = output_dir / filename
            
            if progress_callback:
                progress_callback(i + 1, len(segments), f"İndiriliyor: {filename}")
            
            urllib.request.urlretrieve(segment_url, filepath)
            downloaded_files.append(filepath)
            
        except Exception as e:
            failed_count += 1
            if progress_callback:
                progress_callback(i + 1, len(segments), f"Hata: {filename} - {str(e)}")
    
    return downloaded_files, failed_count

def create_file_list(segments_dir, output_file):
    """FFmpeg için file list oluştur"""
    ts_files = sorted(segments_dir.glob("segment_*.ts"))
    
    with open(output_file, 'w', encoding='utf-8') as f:
        for ts_file in ts_files:
            # FFmpeg concat demuxer için format
            f.write(f"file '{ts_file.absolute()}'\n")
    
    return len(ts_files)

def merge_with_ffmpeg(file_list_path, output_video_path, ffmpeg_path):
    """FFmpeg ile TS dosyalarını birleştir"""
    cmd = [
        ffmpeg_path,
        '-f', 'concat',
        '-safe', '0',
        '-i', str(file_list_path),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        str(output_video_path)
    ]
    
    # FFmpeg'i çalıştır
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    )
    
    stdout, stderr = process.communicate()
    
    return {
        'success': process.returncode == 0,
        'returncode': process.returncode,
        'stdout': stdout,
        'stderr': stderr
    }

def process_hls_segments(message_data):
    """HLS segmentlerini işle ve birleştir"""
    segments = message_data.get('segments', [])
    filename = message_data.get('filename', 'video')
    quality = message_data.get('quality', '')
    
    if not segments:
        return {'success': False, 'error': 'Segment listesi boş'}
    
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        return {'success': False, 'error': 'FFmpeg bulunamadı. ffmpeg.exe dosyasını extension klasörüne ekleyin.'}
    
    try:
        # Geçici klasör oluştur
        with tempfile.TemporaryDirectory(prefix='mgx_segments_') as temp_dir:
            temp_path = Path(temp_dir)
            
            # Progress callback fonksiyonu
            def progress_update(current, total, status):
                send_message({
                    'type': 'progress',
                    'current': current,
                    'total': total,
                    'status': status,
                    'percentage': (current / total) * 100
                })
            
            # Segmentleri indir
            send_message({'type': 'status', 'message': 'TS segmentleri indiriliyor...'})
            downloaded_files, failed_count = download_segments(segments, temp_path, progress_update)
            
            if not downloaded_files:
                return {'success': False, 'error': 'Hiçbir segment indirilemedi'}
            
            # File list oluştur
            file_list_path = temp_path / "file_list.txt"
            segment_count = create_file_list(temp_path, file_list_path)
            
            # Çıktı dosyası
            downloads_dir = Path.home() / "Downloads"
            quality_suffix = f"_{quality}" if quality and quality != 'Bilinmiyor' else ""
            output_filename = f"{filename}{quality_suffix}_merged.mp4"
            output_path = downloads_dir / output_filename
            
            # Aynı isimde dosya varsa sayı ekle
            counter = 1
            while output_path.exists():
                name_part = f"{filename}{quality_suffix}_merged_{counter}"
                output_path = downloads_dir / f"{name_part}.mp4"
                counter += 1
            
            # FFmpeg ile birleştir
            send_message({'type': 'status', 'message': f'FFmpeg ile birleştiriliyor... ({segment_count} segment)'})
            
            result = merge_with_ffmpeg(file_list_path, output_path, ffmpeg_path)
            
            if result['success']:
                file_size = output_path.stat().st_size / (1024 * 1024)  # MB
                return {
                    'success': True,
                    'output_file': str(output_path),
                    'segments_downloaded': len(downloaded_files),
                    'segments_failed': failed_count,
                    'total_segments': len(segments),
                    'file_size_mb': round(file_size, 2)
                }
            else:
                return {
                    'success': False,
                    'error': f'FFmpeg hatası: {result["stderr"][:200]}...'
                }
                
    except Exception as e:
        return {'success': False, 'error': f'İşlem hatası: {str(e)}'}

def main():
    """Ana native messaging loop"""
    send_message({'type': 'ready', 'message': 'FFmpeg native host hazır'})
    
    while True:
        try:
            message = read_message()
            if message is None:
                break
                
            if message.get('type') == 'merge_segments':
                # Segmentleri birleştirme işlemini thread'de çalıştır
                def process_thread():
                    result = process_hls_segments(message.get('data', {}))
                    send_message({'type': 'result', 'data': result})
                
                threading.Thread(target=process_thread, daemon=True).start()
                
            elif message.get('type') == 'check_ffmpeg':
                ffmpeg_path = find_ffmpeg()
                send_message({
                    'type': 'ffmpeg_status',
                    'available': ffmpeg_path is not None,
                    'path': ffmpeg_path
                })
                
        except Exception as e:
            send_message({'type': 'error', 'message': str(e)})
            break

if __name__ == '__main__':
    main()