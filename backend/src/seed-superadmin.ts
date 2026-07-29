import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';

async function seedSuperAdmin() {
  const email = 'superadmin@omni360.vn';
  const password = 'SuperAdmin@360';
  const fullName = 'Super Admin Omni360';

  const passwordHash = await bcrypt.hash(password, 12);

  const existing = await prisma.user.findUnique({
    where: { email }
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        role: 'superadmin',
        passwordHash,
        isActive: true,
      }
    });
    console.log(`✅ [SUPERADMIN] Account updated: ${email} / ${password}`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash,
        fullName,
        role: 'superadmin',
        isActive: true,
      }
    });
    console.log(`✅ [SUPERADMIN] Account created: ${email} / ${password}`);
  }

  await prisma.$disconnect();
  process.exit(0);
}

seedSuperAdmin().catch((err) => {
  console.error('❌ Failed to seed Super Admin:', err);
  process.exit(1);
});
