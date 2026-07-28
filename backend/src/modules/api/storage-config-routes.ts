import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import * as ftp from 'basic-ftp';
import { authMiddleware } from '../auth/auth-middleware.js';

export default async function storageConfigRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware);

  // 1. Get list of FTP configurations
  app.get('/api/v1/storage-configs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).user.orgId;
      const configs = await prisma.storageConfig.findMany({
        where: { orgId },
        orderBy: { createdAt: 'desc' }
      });
      // Hide password for security
      const sanitized = configs.map((c: any) => ({
        ...c,
        password: c.password ? '********' : ''
      }));
      return reply.send(sanitized);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. Create new FTP config
  app.post('/api/v1/storage-configs', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = (request as any).user.orgId;
      const { name, host, port, user, password, mediaUrl } = request.body as any;
      
      const config = await prisma.storageConfig.create({
        data: {
          orgId,
          name,
          type: 'ftp',
          host,
          port: parseInt(port || '21'),
          user,
          password,
          mediaUrl
        }
      });
      return reply.send({ success: true, config });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 3. Update FTP config
  app.put('/api/v1/storage-configs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const orgId = (request as any).user.orgId;
      const { name, host, port, user, password, mediaUrl } = request.body as any;

      const data: any = { name, host, port: parseInt(port || '21'), user, mediaUrl };
      if (password && password !== '********') {
        data.password = password;
      }

      const config = await prisma.storageConfig.updateMany({
        where: { id, orgId },
        data
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 4. Set FTP config as Active
  app.put('/api/v1/storage-configs/:id/activate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const orgId = (request as any).user.orgId;

      // Deactivate all first
      await prisma.storageConfig.updateMany({
        where: { orgId },
        data: { isActive: false }
      });

      // Activate the selected one
      await prisma.storageConfig.updateMany({
        where: { id, orgId },
        data: { isActive: true }
      });

      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 5. Delete FTP config
  app.delete('/api/v1/storage-configs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const orgId = (request as any).user.orgId;
      await prisma.storageConfig.deleteMany({
        where: { id, orgId }
      });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 6. Test FTP connection
  app.post('/api/v1/storage-configs/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const client = new ftp.Client();
    try {
      const { host, port, user, password } = request.body as any;
      await client.access({
        host,
        user,
        password,
        port: parseInt(port || '21'),
        secure: false 
      });
      return reply.send({ success: true, message: 'Kết nối thành công!' });
    } catch (err: any) {
      return reply.status(400).send({ success: false, error: err.message });
    } finally {
      client.close();
    }
  });
}
