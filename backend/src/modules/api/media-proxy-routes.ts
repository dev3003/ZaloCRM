import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import axios from 'axios';
import https from 'node:https';
import * as ftp from 'basic-ftp';
import { PassThrough } from 'node:stream';
import pathModule from 'node:path';

import { config as appConfig } from '../../config/index.js';

function getMimeType(filename: string): string {
  const ext = pathModule.extname(filename).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.mp4': return 'video/mp4';
    case '.pdf': return 'application/pdf';
    default: return 'application/octet-stream';
  }
}

export async function mediaProxyRoutes(app: FastifyInstance) {
  // GET /api/v1/media/:configId/*
  app.get('/api/v1/media/:configId/*', async (request: FastifyRequest, reply: FastifyReply) => {
    const { configId } = request.params as { configId: string };
    const path = (request.params as any)['*'];

    if (!path) {
      return reply.status(400).send({ error: 'Đường dẫn file không hợp lệ' });
    }

    try {
      let config: any = null;
      let mediaUrl = '';

      if (configId === 'legacy') {
        mediaUrl = process.env.MEDIA_URL || '';
        config = {
          host: process.env.FTP_HOST,
          user: process.env.FTP_USER,
          password: process.env.FTP_PASSWORD || '',
          port: parseInt(process.env.FTP_PORT || '21'),
        };
      } else {
        config = await prisma.storageConfig.findUnique({
          where: { id: configId }
        });

        if (!config) {
          return reply.status(404).send({ error: 'Không tìm thấy cấu hình FTP' });
        }
        mediaUrl = config.mediaUrl || '';
      }

      let httpSuccess = false;

      // 1. Cố gắng lấy qua HTTP trước nếu có cấu hình Media URL
      if (mediaUrl) {
        const baseUrl = mediaUrl.endsWith('/') ? mediaUrl.slice(0, -1) : mediaUrl;
        const targetUrl = `${baseUrl}/${path}`;

        try {
          const response = await axios({
            method: 'GET',
            url: targetUrl,
            responseType: 'stream',
            validateStatus: () => true,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
            timeout: 5000 // Timeout nhanh để fallback sang FTP
          });

          const contentType = response.headers['content-type'] || '';

          // Phải là HTTP 200 và không phải là mã HTML (để chống việc Frontend trả về index.html giả dạng 200 OK)
          if (response.status === 200 && !String(contentType).includes('text/html')) {
            httpSuccess = true;
            logger.info(`[media-proxy] HTTP Proxy thành công: ${targetUrl}`);

            if (contentType) reply.header('Content-Type', contentType);

            const contentLength = response.headers['content-length'];
            if (contentLength) reply.header('Content-Length', contentLength);

            return reply.send(response.data);
          } else {
            logger.warn(`[media-proxy] HTTP Proxy thất bại (Status: ${response.status}, Type: ${contentType}), chuyển sang FTP.`);
          }
        } catch (err: any) {
          logger.warn(`[media-proxy] HTTP Proxy thất bại, chuyển sang FTP: ${err.message}`);
        }
      }

      // 2. Fallback: Lấy trực tiếp qua giao thức FTP (Chậm hơn nhưng chắc chắn)
      if (!httpSuccess && config && config.host) {
        logger.info(`[media-proxy] Đang dùng FTP Stream để tải: /${path}`);

        const client = new ftp.Client();
        await client.access({
          host: config.host,
          user: config.user,
          password: config.password,
          port: config.port || 21,
          secure: false
        });

        const stream = new PassThrough();

        // Bắt đầu tải background stream
        client.downloadTo(stream, `/${path}`).then(() => {
          client.close();
        }).catch(err => {
          logger.error(`[media-proxy] Lỗi stream FTP: ${err.message}`);
          client.close();
        });

        reply.header('Content-Type', getMimeType(path));
        return reply.send(stream);
      }

      if (!httpSuccess) {
        return reply.status(404).send({ error: 'File không tồn tại trên cả HTTP và FTP' });
      }

    } catch (err: any) {
      logger.error(`[media-proxy] Lỗi tổng quan: ${err.message}`);
      return reply.status(500).send({ error: 'Lỗi máy chủ khi lấy file' });
    }
  });
}
