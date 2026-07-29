/**
 * Auth routes — setup, login, and profile endpoints.
 * Registered as a Fastify plugin via app.register(authRoutes).
 */
import type { FastifyInstance } from 'fastify';
import { authMiddleware } from './auth-middleware.js';
import {
  checkSetupStatus,
  setup,
  login,
  superAdminLogin,
  registerOrganization,
  getProfile,
} from './auth-service.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/v1/setup/status — check if first-run setup is needed
  app.get('/api/v1/setup/status', async () => {
    return checkSetupStatus();
  });

  // POST /api/v1/setup — create org + owner user, return JWT
  app.post<{
    Body: { orgName: string; fullName: string; email: string; password: string };
  }>('/api/v1/setup', async (request, reply) => {
    const { orgName, fullName, email, password } = request.body;
    if (!orgName || !fullName || !email || !password) {
      return reply.status(400).send({ error: 'Missing required fields' });
    }
    const payload = await setup(orgName, fullName, email, password);
    const token = app.jwt.sign(payload, { expiresIn: '7d' });
    return { token, user: payload };
  });

  // POST /api/v1/auth/register-organization — Self-service org registration
  app.post<{
    Body: { orgName: string; fullName: string; email: string; password: string };
  }>('/api/v1/auth/register-organization', async (request, reply) => {
    const { orgName, fullName, email, password } = request.body;
    if (!orgName || !fullName || !email || !password) {
      return reply.status(400).send({ error: 'Vui lòng điền đầy đủ các thông tin bắt buộc' });
    }
    try {
      const payload = await registerOrganization(orgName, fullName, email, password);
      const token = app.jwt.sign(payload, { expiresIn: '7d' });
      return { token, user: payload };
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ error: err.message || 'Đăng ký thất bại' });
    }
  });

  // POST /api/v1/auth/login — verify credentials, return JWT
  app.post<{
    Body: { email: string; password: string };
  }>('/api/v1/auth/login', async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Missing email or password' });
    }
    const payload = await login(email, password);

    if (app.io) {
      app.io.to(`user:${payload.id}`).emit('force-logout', {
        reason: 'Tài khoản của bạn đã được đăng nhập từ một thiết bị khác.'
      });
    }

    const token = app.jwt.sign(payload, { expiresIn: '7d' });
    return { token, user: payload };
  });

  // POST /api/v1/auth/super-admin/login — Dedicated login portal for Super Admin
  app.post<{
    Body: { email: string; password: string };
  }>('/api/v1/auth/super-admin/login', async (request, reply) => {
    const { email, password } = request.body;
    if (!email || !password) {
      return reply.status(400).send({ error: 'Vui lòng nhập đầy đủ Email và Mật khẩu' });
    }
    try {
      const payload = await superAdminLogin(email, password);

      if (app.io) {
        app.io.to(`user:${payload.id}`).emit('force-logout', {
          reason: 'Tài khoản Super Admin của bạn đã được đăng nhập từ một thiết bị khác.'
        });
      }

      const token = app.jwt.sign(payload, { expiresIn: '7d' });
      return { token, user: payload };
    } catch (err: any) {
      return reply.status(err.statusCode || 400).send({ error: err.message || 'Đăng nhập Quản trị thất bại' });
    }
  });

  // GET /api/v1/profile — return current user (requires auth)
  app.get('/api/v1/profile', { preHandler: authMiddleware }, async (request) => {
    const user = request.user as { id: string; email: string; role: string; orgId: string };
    return getProfile(user.id);
  });
}
