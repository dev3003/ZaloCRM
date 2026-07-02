import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../shared/database/prisma-client.js';
import { authMiddleware } from '../auth/auth-middleware.js';
import crypto from 'node:crypto';

export async function agentRoutes(app: FastifyInstance) {
  // All agent routes require auth and owner role
  app.addHook('preHandler', authMiddleware);

  // List agent keys
  app.get('/api/v1/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (user.role !== 'owner') return reply.status(403).send({ error: 'Forbidden' });
    
    const agents = await prisma.zaloDesktopAgent.findMany({
      where: { orgId: user.orgId },
      orderBy: { createdAt: 'desc' }
    });
    
    // Mask agentKey for security in list view, except for the first 8 chars
    const maskedAgents = agents.map(agent => ({
      ...agent,
      agentKey: agent.agentKey.substring(0, 8) + '************************'
    }));

    reply.send(maskedAgents);
  });

  // Create new agent key
  app.post('/api/v1/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (user.role !== 'owner') return reply.status(403).send({ error: 'Forbidden' });

    const { name = 'Desktop Agent' } = request.body as { name?: string };

    const rawKey = crypto.randomBytes(32).toString('hex');
    
    const agent = await prisma.zaloDesktopAgent.create({
      data: {
        orgId: user.orgId,
        agentKey: rawKey,
        name
      }
    });

    reply.send({ ...agent, agentKey: rawKey });
  });

  // Revoke agent key
  app.post('/api/v1/agents/:id/revoke', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (user.role !== 'owner') return reply.status(403).send({ error: 'Forbidden' });

    const { id } = request.params as { id: string };

    const agent = await prisma.zaloDesktopAgent.findUnique({
      where: { id, orgId: user.orgId }
    });

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    await prisma.zaloDesktopAgent.update({
      where: { id },
      data: { status: 'revoked' }
    });

    // Note: We might also want to forcefully disconnect the active socket here.
    // This could be done by emitting an event or keeping track of active sockets in agent-socket.ts
    // For now, updating status to revoked will prevent reconnection.

    reply.send({ success: true, message: 'Agent key revoked' });
  });
}
