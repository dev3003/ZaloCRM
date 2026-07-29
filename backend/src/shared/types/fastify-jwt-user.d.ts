/**
 * Extends Fastify's JWT user type to include our custom JWT payload fields.
 * This merges with @fastify/jwt's FastifyJWT interface.
 */
import '@fastify/jwt';
import type { Server } from 'socket.io';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { id: string; email: string; role: string; orgId: string; teamId?: string; sessionId?: string };
    user: { id: string; email: string; role: string; orgId: string; teamId?: string; sessionId?: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    io: Server;
  }
}
