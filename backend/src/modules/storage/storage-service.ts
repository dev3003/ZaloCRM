/**
 * storage-service.ts — Chuyên xử lý việc tải và lưu trữ file.
 * Hỗ trợ linh hoạt giữa Server Test (Local) và Server Media (FTP).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import * as ftp from 'basic-ftp';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import crypto from 'node:crypto';
import { VideoProcessor } from '../../shared/utils/video-processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_ROOT = path.join(__dirname, '../../../static/uploads');

// Định nghĩa Interface chung cho việc lưu trữ
interface StorageProvider {
  saveFile(url: string, destPath: string): Promise<string>;
  saveBuffer(buffer: Buffer, destPath: string): Promise<string>; // New method
  deleteFile(relativePath: string): Promise<void>;
}

/**
 * 1. FTP STORAGE PROVIDER (Dành cho media-crm-zalo.dev.web360.vn)
 */
class FtpStorageProvider implements StorageProvider {
  private config = {
    host: process.env.FTP_HOST,
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: parseInt(process.env.FTP_PORT || '21'),
    // Mặc định dùng subdomain media của bạn
    mediaUrl: process.env.MEDIA_URL || 'https://media-crm-zalo.dev.web360.vn'
  };

  async saveFile(url: string, relativePath: string): Promise<string> {
    const client = new ftp.Client();
    try {
      await client.access({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        port: this.config.port,
        secure: false 
      });

      const remotePath = relativePath.replace(/\\/g, '/');
      const dir = path.dirname(remotePath);
      const filename = path.basename(remotePath);
      
      await client.ensureDir(dir);

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      
      const stream = Readable.from(Buffer.from(arrayBuffer));
      await client.uploadFrom(stream, filename);

      return `${this.config.mediaUrl}/${remotePath}`;
    } catch (err) {
      logger.error('[storage-ftp] Lỗi upload FTP:', err);
      throw err;
    } finally {
      client.close();
    }
  }

  async saveBuffer(buffer: Buffer, relativePath: string): Promise<string> {
    const client = new ftp.Client();
    try {
      await client.access({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        port: this.config.port,
        secure: false 
      });

      const remotePath = relativePath.replace(/\\/g, '/');
      const dir = path.dirname(remotePath);
      const filename = path.basename(remotePath);
      
      await client.ensureDir(dir);
      const stream = Readable.from(buffer);
      await client.uploadFrom(stream, filename);

      return `${this.config.mediaUrl}/${remotePath}`;
    } catch (err) {
      logger.error('[storage-ftp] Lỗi saveBuffer FTP:', err);
      throw err;
    } finally {
      client.close();
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const client = new ftp.Client();
    try {
      await client.access({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        port: this.config.port,
        secure: false 
      });
      const remotePath = relativePath.replace(/\\/g, '/');
      await client.remove(remotePath).catch(err => {
        if (err.code !== 550) throw err; // 550 usually means file not found, which is fine
      });
    } catch (err) {
      logger.error('[storage-ftp] Lỗi xóa file FTP:', err);
    } finally {
      client.close();
    }
  }
}

/**
 * 2. LOCAL STORAGE PROVIDER (Dành cho crm-zalo-api.dev.web360.vn/uploads)
 */
class LocalStorageProvider implements StorageProvider {
  async saveFile(url: string, relativePath: string): Promise<string> {
    const fullPath = path.join(UPLOADS_ROOT, relativePath);
    const dir = path.dirname(fullPath);
    
    await fs.mkdir(dir, { recursive: true });
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
    
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(fullPath, Buffer.from(arrayBuffer));
    
    // Mặc định dùng subdomain API của bạn
    const baseUrl = process.env.API_URL || 'https://crm-zalo-api.dev.web360.vn';
    return `${baseUrl}/uploads/${relativePath.replace(/\\/g, '/')}`;
  }

  async saveBuffer(buffer: Buffer, relativePath: string): Promise<string> {
    const fullPath = path.join(UPLOADS_ROOT, relativePath);
    const dir = path.dirname(fullPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, buffer);
    const baseUrl = process.env.API_URL || 'https://crm-zalo-api.dev.web360.vn';
    return `${baseUrl}/uploads/${relativePath.replace(/\\/g, '/')}`;
  }

  async deleteFile(relativePath: string): Promise<void> {
    const fullPath = path.join(UPLOADS_ROOT, relativePath);
    try {
      await fs.unlink(fullPath).catch(err => {
        if (err.code !== 'ENOENT') throw err;
      });
    } catch (err) {
      logger.error('[storage-local] Lỗi xóa file Local:', err);
    }
  }
}

/**
 * SERVICE QUẢN LÝ CHÍNH
 */
export class StorageService {
  private provider: StorageProvider;

  constructor() {
    // TỰ ĐỘNG CHỌN: Nếu .env có FTP_HOST thì dùng FTP, không thì dùng Local
    if (process.env.FTP_HOST && process.env.FTP_USER) {
      logger.info('[storage] Provider: FTP (media-crm-zalo.dev.web360.vn)');
      this.provider = new FtpStorageProvider();
    } else {
      logger.info('[storage] Provider: LOCAL (crm-zalo-api.dev.web360.vn)');
      this.provider = new LocalStorageProvider();
    }
  }

  async processMessageFiles(messageId: string): Promise<void> {
    try {
      const message = await prisma.message.findUnique({ where: { id: messageId } });
      if (!message || message.contentType === 'text' || message.fileStatus === 'success') return;

      await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'pending' } });
      logger.info(`[storage] 🔄 Đang bắt đầu tải file cho tin nhắn: ${messageId}`);

      let contentObj: any;
      try {
        contentObj = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
      } catch {
        await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'none' } });
        return;
      }

      const sentAt = new Date(message.sentAt);
      const year = sentAt.getFullYear().toString();
      const month = (sentAt.getMonth() + 1).toString().padStart(2, '0');
      const day = sentAt.getDate().toString().padStart(2, '0');
      const datePrefix = path.join(year, month, day);
      const updatedContent = { ...contentObj };
      let changed = false;

      const urlKeys = ['href', 'thumb', 'hd'];
      if (message.contentType === 'file') urlKeys.push('url');

      for (const key of urlKeys) {
        let originalUrl = updatedContent[key];
        
        if (key === 'hd' && !originalUrl && updatedContent.params) {
          try {
            const params = JSON.parse(updatedContent.params);
            if (params.hd) {
              const originalFileName = updatedContent.name || updatedContent.title || undefined;
              const localUrl = await this.saveSpecificFile(params.hd, datePrefix, messageId, 'hd', originalFileName);
              params.hd = localUrl;
              updatedContent.params = JSON.stringify(params);
              changed = true;
              continue;
            }
          } catch {}
        }

        if (originalUrl && typeof originalUrl === 'string' && originalUrl.startsWith('http')) {
          const originalFileName = updatedContent.name || updatedContent.title || undefined;
          const localUrl = await this.saveSpecificFile(originalUrl, datePrefix, messageId, key, originalFileName);
          updatedContent[key] = localUrl;
          changed = true;
        }
      }

      if (changed) {
        await prisma.message.update({
          where: { id: messageId },
          data: { content: JSON.stringify(updatedContent), fileStatus: 'success' }
        });
        logger.info(`[storage] ✅ Đã tải và lưu file thành công lên FTP cho tin nhắn: ${messageId}`);
      } else {
        await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'none' } });
      }
    } catch (error) {
      logger.error(`[storage] Error processing files for ${messageId}:`, error);
      await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'failed' } });
    }
  }

  private async saveSpecificFile(url: string, datePrefix: string, messageId: string, suffix: string, originalName?: string): Promise<string> {
    const urlObj = new URL(url);
    let ext = path.extname(urlObj.pathname);

    // Nếu không lấy được ext từ URL, thử lấy từ tên gốc (nếu có)
    if (!ext && originalName) {
      ext = path.extname(originalName);
    }

    // Nếu vẫn không có ext, hoặc là .bin, thử check Content-Type
    if (!ext || ext === '.bin' || ext === '.bin') {
      try {
        const res = await fetch(url, { method: 'HEAD' });
        const contentType = res.headers.get('content-type');
        if (contentType) {
          const mimeMap: Record<string, string> = {
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.ms-excel': '.xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'application/vnd.ms-powerpoint': '.ppt',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'application/zip': '.zip',
            'application/x-rar-compressed': '.rar',
            'application/x-zip-compressed': '.zip',
            'application/sql': '.sql',
            'text/sql': '.sql',
            'text/plain': '.txt',
            'text/csv': '.csv',
            'application/json': '.json',
            'application/xml': '.xml',
            'text/html': '.html',
          };
          const detectedExt = mimeMap[contentType.split(';')[0].toLowerCase()];
          if (detectedExt) ext = detectedExt;
        }
      } catch (err) {
        logger.debug(`[storage] HEAD request failed for extension detection: ${url}`);
      }
    }

    // Fallback mặc định nếu vẫn không có
    if (!ext) ext = url.includes('jpg') ? '.jpg' : '.bin';

    const filename = `${messageId}_${suffix}${ext}`;
    logger.info(`[storage] Detected extension "${ext}" for message ${messageId} (suffix: ${suffix})`);
    
    const relativePath = path.join(datePrefix, filename);
    return await this.provider.saveFile(url, relativePath);
  }

  async deleteMessageFiles(messageId: string): Promise<void> {
    // ... existing deleteMessageFiles logic ...
  }

  /**
   * New: Process files directly from multipart upload
   */
  async processUploadedFiles(files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>) {
    const results = [];
    const now = new Date();
    const datePrefix = path.join(
      now.getFullYear().toString(),
      (now.getMonth() + 1).toString().padStart(2, '0'),
      now.getDate().toString().padStart(2, '0'),
      'uploads'
    );

    for (const file of files) {
      const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');
      const ext = path.extname(file.originalname);
      const filename = `${hash}${ext}`;
      const relativePath = path.join(datePrefix, filename);

      // Save original file
      const url = await this.provider.saveBuffer(file.buffer, relativePath);

      let type: 'image' | 'video' | 'file' = 'file';
      if (file.mimetype.startsWith('image/')) type = 'image';
      else if (file.mimetype.startsWith('video/')) type = 'video';

      let metadata: any = {};
      let thumbUrl: string | undefined;

      if (type === 'video') {
        const tempPath = path.join(__dirname, `../../../temp_${hash}${ext}`);
        const thumbTempPath = path.join(__dirname, `../../../temp_thumb_${hash}.jpg`);
        
        try {
          await fs.writeFile(tempPath, file.buffer);
          metadata = await VideoProcessor.getMetadata(tempPath);
          await VideoProcessor.generateThumbnail(tempPath, thumbTempPath);
          
          const thumbBuffer = await fs.readFile(thumbTempPath);
          const thumbRelativePath = path.join(datePrefix, `${hash}_thumb.jpg`);
          thumbUrl = await this.provider.saveBuffer(thumbBuffer, thumbRelativePath);

          // Cleanup temp files
          await fs.unlink(tempPath).catch(() => {});
          await fs.unlink(thumbTempPath).catch(() => {});
        } catch (err) {
          logger.error('[storage] Video processing failed:', err);
        }
      }

      results.push({
        url,
        type,
        hash,
        thumb: thumbUrl,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height
      });
    }
    return results;
  }
}

export const storageService = new StorageService();
export const StorageServiceInstance = storageService; // for static access if needed
