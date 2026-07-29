/**
 * Auth service — handles setup, login, and profile operations.
 * Uses bcryptjs for password hashing and Fastify JWT for token signing.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export interface JwtPayload {
  id: string;
  email: string;
  role: string;
  orgId: string;
  sessionId?: string;
}

// Check if any users exist — true means first-run setup is needed
export async function checkSetupStatus(): Promise<{ needsSetup: boolean }> {
  const count = await prisma.user.count();
  return { needsSetup: count === 0 };
}

// Create the initial organization + owner user, return JWT payload
export async function setup(
  orgName: string,
  fullName: string,
  email: string,
  password: string,
): Promise<JwtPayload> {
  const existing = await prisma.user.count();
  if (existing > 0) {
    const err = new Error('Setup already completed') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const sessionId = randomUUID();

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    const user = await tx.user.create({
      data: {
        orgId: org.id,
        email: email.toLowerCase().trim(),
        passwordHash,
        fullName,
        role: 'owner',
        currentSessionId: sessionId,
      },
    });
    return { org, user };
  });

  logger.info(`Setup complete — org=${result.org.id}, user=${result.user.id}`);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    orgId: result.org.id,
    sessionId,
  };
}

// Register a brand new Organization + Owner User + Auto-create 1 Dedicated Agent Server & Key
export async function registerOrganization(
  orgName: string,
  fullName: string,
  email: string,
  password: string,
): Promise<JwtPayload> {
  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
  });

  if (existingUser) {
    const err = new Error('Email này đã được sử dụng trên hệ thống') as Error & { statusCode: number };
    err.statusCode = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const sessionId = randomUUID();
  const agentKey = 'zk_live_' + randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: orgName, status: 'active' }
    });

    const user = await tx.user.create({
      data: {
        orgId: org.id,
        email: email.toLowerCase().trim(),
        passwordHash,
        fullName,
        role: 'owner',
        currentSessionId: sessionId,
      },
    });

    const agent = await tx.zaloDesktopAgent.create({
      data: {
        orgId: org.id,
        agentKey,
        name: `Máy chủ Agent ${orgName}`,
        status: 'active',
      }
    });

    return { org, user, agent };
  });

  logger.info(`Organization registered — org=${result.org.id}, user=${result.user.id}, agentKey=${result.agent.agentKey}`);

  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    orgId: result.org.id,
    sessionId,
  };
}

// Verify credentials, return JWT payload
export async function login(email: string, password: string): Promise<JwtPayload> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { org: true }
  });

  if (!user || !user.isActive) {
    const err = new Error('Email hoặc mật khẩu không chính xác') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }

  // Check if organization is suspended for non-superadmin users
  if (user.role !== 'superadmin' && user.org && user.org.status === 'suspended') {
    const err = new Error('Tài khoản Tổ chức của bạn đã bị tạm khóa. Vui lòng liên hệ Quản trị viên hệ thống.') as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error('Email hoặc mật khẩu không chính xác') as Error & { statusCode: number };
    err.statusCode = 401;
    throw err;
  }

  const sessionId = randomUUID();
  await prisma.user.update({
    where: { id: user.id },
    data: { currentSessionId: sessionId },
  });

  return { id: user.id, email: user.email, role: user.role, orgId: user.orgId || '', sessionId };
}

// Return safe user profile (no password hash)
export async function getProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      orgId: true,
      teamId: true,
      isActive: true,
      createdAt: true,
      org: { select: { id: true, name: true } },
      team: { select: { id: true, name: true, tags: true } },
    },
  });

  if (!user) {
    const err = new Error('User not found') as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }

  return user;
}
