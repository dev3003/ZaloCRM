import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
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
    const orgs = await prisma.organization.findMany();
    console.log('=== Organizations ===');
    console.log(JSON.stringify(orgs, null, 2));

    const settings = await prisma.appSetting.findMany();
    console.log('=== App Settings ===');
    console.log(JSON.stringify(settings, null, 2));

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        adminSaleId: true,
        orgId: true
      }
    });
    console.log('=== Users ===');
    console.log(JSON.stringify(users, null, 2));

    const agents = await prisma.zaloDesktopAgent.findMany();
    console.log('=== Desktop Agents ===');
    console.log(JSON.stringify(agents, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
