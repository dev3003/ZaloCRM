import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  try {
    // 1. Create Organization
    const orgName = 'HOSTINGVIET';
    let org = await prisma.organization.findFirst({
      where: { name: orgName }
    });

    if (!org) {
      org = await prisma.organization.create({
        data: {
          name: orgName,
          status: 'active'
        }
      });
      console.log(`Created Organization: ${orgName} (${org.id})`);
    } else {
      console.log(`Organization exists: ${orgName} (${org.id})`);
    }

    // 2. Create Owner User
    const email = 'owner@hostingviet.vn';
    const password = 'HostingViet@123';
    const passwordHash = await bcrypt.hash(password, 12);
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: 'HostingViet Owner',
          role: 'owner',
          isActive: true,
          orgId: org.id,
          adminSaleId: '55555' // matches sale_id in mock data
        }
      });
      console.log(`Created User: ${email}`);
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          orgId: org.id,
          role: 'owner',
          adminSaleId: '55555'
        }
      });
      console.log(`User updated: ${email}`);
    }

    // 3. Create settings
    const settings = [
      { key: 'erp_api_url', val: 'http://localhost:3000/api/v1/erp/mock-data' },
      { key: 'erp_api_key', val: 'test-erp-key' },
      { key: 'erp_decrypt_key', val: 'ERPCRMZALO123456' },
      { key: 'CRON_LOG_WEBHOOK_URL', val: 'https://api.telegram.org/bot123456:ABC/sendMessage' },
      { key: 'CRON_LOG_TELEGRAM_CHAT_ID', val: '-100123456789' }
    ];

    for (const s of settings) {
      await prisma.appSetting.upsert({
        where: { orgId_settingKey: { orgId: org.id, settingKey: s.key } },
        create: { orgId: org.id, settingKey: s.key, valuePlain: s.val },
        update: { valuePlain: s.val }
      });
    }
    console.log('Upserted ERP and Cron settings');

    // 4. Create Zalo Account for connection tests
    let zaloAcc = await prisma.zaloAccount.findFirst({
      where: { orgId: org.id }
    });

    if (!zaloAcc) {
      zaloAcc = await prisma.zaloAccount.create({
        data: {
          orgId: org.id,
          ownerUserId: user.id,
          displayName: 'Test Zalo Sales',
          status: 'connected',
          phone: '0987654321',
          zaloUid: 'zalo-uid-123'
        }
      });
      console.log(`Created Zalo Account: ${zaloAcc.displayName} (${zaloAcc.id})`);
    } else {
      await prisma.zaloAccount.update({
        where: { id: zaloAcc.id },
        data: { status: 'connected', zaloUid: 'zalo-uid-123' }
      });
      console.log(`Zalo Account exists: ${zaloAcc.displayName}`);
    }

    // 5. Create Contact with matching customer_id (from mock ERP)
    const adminCustomerId = '11111';
    let contact = await prisma.contact.findFirst({
      where: { orgId: org.id, adminCustomerId }
    });

    if (!contact) {
      contact = await prisma.contact.create({
        data: {
          orgId: org.id,
          fullName: 'Khách Hàng ERP 01',
          phone: '0912345678',
          adminCustomerId,
          status: 'new'
        }
      });
      console.log(`Created Contact: ${contact.fullName} (${contact.id})`);
    } else {
      console.log(`Contact exists: ${contact.fullName}`);
    }

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
