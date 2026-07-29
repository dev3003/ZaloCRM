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
import { config } from '../../config/index.js';

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
  private config: any;

  constructor(config: any) {
    this.config = config;
  }

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

      // Thêm headers giả lập trình duyệt để vượt qua kiểm tra Referer/User-Agent của Zalo CDN
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
      let response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://chat.zalo.me/',
            'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          }
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new Error(`Failed to download (HTTP ${response.status}): ${url.substring(0, 100)}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      
      const stream = Readable.from(Buffer.from(arrayBuffer));
      await client.uploadFrom(stream, filename);

      const apiUrl = process.env.API_URL || this.config.apiUrl || this.config.appUrl;
      return `${apiUrl}/api/v1/media/${this.config.id}/${remotePath}`;
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

      const apiUrl = process.env.API_URL || this.config.apiUrl || this.config.appUrl;
      return `${apiUrl}/api/v1/media/${this.config.id}/${remotePath}`;
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
    
    // Thêm headers giả lập trình duyệt để vượt qua kiểm tra Referer/User-Agent của Zalo CDN
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://chat.zalo.me/',
          'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Failed to download (HTTP ${response.status}): ${url.substring(0, 100)}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    await fs.writeFile(fullPath, Buffer.from(arrayBuffer));
    
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
  private io: any = null;

  setIO(io: any) {
    this.io = io;
  }

  private async getProvider(orgId?: string): Promise<StorageProvider> {
    let activeConfig = orgId ? await prisma.storageConfig.findFirst({
      where: { orgId, isActive: true }
    }) : null;

    if (!activeConfig) {
      activeConfig = await prisma.storageConfig.findFirst({
        where: { isActive: true }
      });
    }

    if (activeConfig && activeConfig.type === 'ftp') {
      logger.info(`[storage] Provider: FTP (${activeConfig.name} - ${activeConfig.host})`);
      // Lấy từ DB
      return new FtpStorageProvider({
        id: activeConfig.id,
        host: activeConfig.host || '',
        user: activeConfig.user || '',
        password: activeConfig.password || '',
        port: activeConfig.port || 21,
        mediaUrl: activeConfig.mediaUrl || config.appUrl,
        appUrl: config.appUrl
      });
    }

    // Fallback .env FTP
    if (process.env.FTP_HOST && process.env.FTP_USER) {
      logger.info('[storage] Provider: FTP (.env fallback)');
      return new FtpStorageProvider({
        id: 'legacy',
        host: process.env.FTP_HOST,
        user: process.env.FTP_USER,
        password: process.env.FTP_PASSWORD || '',
        port: parseInt(process.env.FTP_PORT || '21'),
        mediaUrl: process.env.MEDIA_URL || config.appUrl,
        appUrl: config.appUrl
      });
    }

    logger.info('[storage] Provider: LOCAL');
    return new LocalStorageProvider();
  }

  // Tất cả contentType từ Zalo có thể chứa file media
  private isMediaContentType(contentType: string): boolean {
    const mediaTypes = [
      'image', 'photo', 'chat.photo',
      'file', 'chat.file', 'document',
      'video', 'chat.video',
      'voice', 'audio',
      'gif'
    ];
    return mediaTypes.includes(contentType.toLowerCase());
  }

  async processMessageFiles(messageId: string): Promise<void> {
    let message: any = null;
    try {
      message = await prisma.message.findUnique({ 
        where: { id: messageId },
        include: { conversation: { select: { orgId: true, contactId: true } } }
      });

      if (!message || message.contentType === 'text' || message.fileStatus === 'success') return;
      if (!this.isMediaContentType(message.contentType)) {
        // Không phải loại file media được hỗ trợ — đánh dấu none và thoát
        await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'none' } });
        return;
      }
      
      const orgId = message.conversation.orgId;

      await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'pending' } });
      logger.info(`[storage] 🔄 Đang bắt đầu tải file (${message.contentType}) cho tin nhắn: ${messageId}`);

      let contentObj: any;
      try {
        contentObj = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
      } catch {
        // Nếu content không phải JSON, có thể là URL trực tiếp
        if (message.content && message.content.startsWith('http')) {
          contentObj = { href: message.content };
        } else {
          await prisma.message.update({ where: { id: messageId }, data: { fileStatus: 'none' } });
          return;
        }
      }

      const sentAt = new Date(message.sentAt);
      const year = sentAt.getFullYear().toString();
      const month = (sentAt.getMonth() + 1).toString().padStart(2, '0');
      const day = sentAt.getDate().toString().padStart(2, '0');
      const datePrefix = path.join(year, month, day);
      const updatedContent = { ...contentObj };
      let changed = false;

      // Tất cả các key URL có thể có trong payload Zalo
      // href: URL chính (ảnh/file), thumb: ảnh thumbnail, hd: ảnh HD, url: URL thay thế
      const urlKeys = ['href', 'url', 'thumb', 'hd'];

      for (const key of urlKeys) {
        let originalUrl = updatedContent[key];
        
        // Xử lý ảnh HD nằm trong trường params (định dạng JSON lồng nhau)
        if (key === 'hd' && !originalUrl && updatedContent.params) {
          try {
            const params = typeof updatedContent.params === 'string'
              ? JSON.parse(updatedContent.params)
              : updatedContent.params;
            if (params.hd && params.hd.startsWith('http')) {
              const originalFileName = updatedContent.name || updatedContent.title || undefined;
              const localUrl = await this.saveSpecificFile(params.hd, datePrefix, messageId, 'hd', orgId, originalFileName);
              params.hd = localUrl;
              updatedContent.params = JSON.stringify(params);
              changed = true;
              continue;
            }
          } catch {}
        }

        if (originalUrl && typeof originalUrl === 'string' && originalUrl.startsWith('http')) {
          // Bỏ qua nếu URL đã được lưu trên FTP/local của hệ thống (tránh upload lại)
          const isAlreadySaved = originalUrl.includes('/api/v1/media/') || 
                                  originalUrl.includes('/uploads/');
          if (isAlreadySaved) {
            logger.debug(`[storage] URL already saved, skipping: ${originalUrl.substring(0, 80)}...`);
            continue;
          }

          const originalFileName = updatedContent.name || updatedContent.title || undefined;
          try {
            const localUrl = await this.saveSpecificFile(originalUrl, datePrefix, messageId, key, orgId, originalFileName);
            updatedContent[key] = localUrl;
            changed = true;
            logger.info(`[storage] 📥 Saved ${key}: ${localUrl.substring(0, 80)}...`);
          } catch (saveErr: any) {
            logger.error(`[storage] Failed to save ${key} for ${messageId}: ${saveErr.message}`);
            // Tiếp tục với các key khác dù key này lỗi
          }
        }
      }

      if (changed) {
        const updatedMsg = await prisma.message.update({
          where: { id: messageId },
          data: { content: JSON.stringify(updatedContent), fileStatus: 'success' }
        });
        logger.info(`[storage] ✅ Đã tải và lưu file thành công cho tin nhắn: ${messageId}`);

        if (this.io) {
          try {
            const { emitSecureMessage } = await import('../chat/message-handler.js');
            await emitSecureMessage(this.io, {
              message: updatedMsg as any,
              conversationId: message.conversationId,
              orgId: message.conversation.orgId,
              contactId: message.conversation.contactId
            });
          } catch (emitErr) {
            logger.error(`[storage] Failed to emit updated message via socket:`, emitErr);
          }
        }
      } else {
        const updatedMsg = await prisma.message.update({
          where: { id: messageId },
          data: { fileStatus: 'none' }
        });
        logger.debug(`[storage] No downloadable URLs found for message ${messageId}`);

        if (this.io) {
          try {
            const { emitSecureMessage } = await import('../chat/message-handler.js');
            await emitSecureMessage(this.io, {
              message: updatedMsg as any,
              conversationId: message.conversationId,
              orgId: message.conversation.orgId,
              contactId: message.conversation.contactId
            });
          } catch (emitErr) {
            logger.error(`[storage] Failed to emit updated message via socket:`, emitErr);
          }
        }
      }
    } catch (error) {
      logger.error(`[storage] Error processing files for ${messageId}:`, error);
      try {
        const updatedMsg = await prisma.message.update({
          where: { id: messageId },
          data: { fileStatus: 'failed' }
        });
        if (this.io && message) {
          const { emitSecureMessage } = await import('../chat/message-handler.js');
          await emitSecureMessage(this.io, {
            message: updatedMsg as any,
            conversationId: message.conversationId,
            orgId: message.conversation.orgId,
            contactId: message.conversation.contactId
          });
        }
      } catch (dbErr) {
        logger.error(`[storage] Failed to set status to failed for ${messageId}:`, dbErr);
      }
    }
  }

  private async saveSpecificFile(url: string, datePrefix: string, messageId: string, suffix: string, orgId: string, originalName?: string): Promise<string> {
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
    const provider = await this.getProvider(orgId);
    return await provider.saveFile(url, relativePath);
  }

  async deleteMessageFiles(messageId: string): Promise<void> {
    // ... existing deleteMessageFiles logic ...
  }

  /**
   * New: Process files directly from multipart upload
   */
  async processUploadedFiles(orgId: string, files: Array<{ buffer: Buffer; originalname: string; mimetype: string }>) {
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
      const provider = await this.getProvider(orgId);

      // Save original file
      const url = await provider.saveBuffer(file.buffer, relativePath);

      let type: 'image' | 'video' | 'file' = 'file';
      const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.3gp'];
      if (file.mimetype.startsWith('image/')) type = 'image';
      else if (file.mimetype.startsWith('video/') || videoExtensions.includes(ext.toLowerCase())) type = 'video';

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
          thumbUrl = await provider.saveBuffer(thumbBuffer, thumbRelativePath);

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
