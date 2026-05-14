import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';

export interface VideoMetadata {
  duration?: number;
  width?: number;
  height?: number;
  format?: string;
}

export class VideoProcessor {
  /**
   * Extract metadata using ffprobe
   */
  static async getMetadata(filePath: string): Promise<VideoMetadata> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filePath
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => output += data);
      ffprobe.on('close', (code) => {
        if (code !== 0) return reject(new Error(`ffprobe failed with code ${code}`));
        try {
          const data = JSON.parse(output);
          const videoStream = data.streams.find((s: any) => s.codec_type === 'video');
          const duration = parseFloat(data.format.duration) * 1000; // to ms

          resolve({
            duration: isNaN(duration) ? undefined : duration,
            width: videoStream?.width,
            height: videoStream?.height,
            format: data.format.format_name
          });
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Generate thumbnail using ffmpeg
   */
  static async generateThumbnail(videoPath: string, thumbPath: string, seekSeconds = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-ss', seekSeconds.toString(),
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        '-vf', 'scale=480:-1', // Resize to 480px width, maintain aspect
        thumbPath,
        '-y' // Overwrite
      ]);

      ffmpeg.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg failed with code ${code}`));
      });
    });
  }
}
