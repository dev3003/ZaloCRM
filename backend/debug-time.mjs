import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n===== KIỂM TRA THỜI GIAN HỆ THỐNG =====\n');
  
  const nodeTime = new Date();
  console.log(`1. Giờ Node.js (Backend process):`);
  console.log(`   - UTC:   ${nodeTime.toUTCString()}`);
  console.log(`   - Local: ${nodeTime.toString()}`);
  console.log(`   - Epoch: ${nodeTime.getTime()}`);
  
  try {
    const dbTimeRaw = await prisma.$queryRaw`SELECT NOW() as now`;
    const dbTime = dbTimeRaw[0]?.now;
    console.log(`\n2. Giờ Database (PostgreSQL):`);
    console.log(`   - UTC:   ${new Date(dbTime).toUTCString()}`);
    console.log(`   - Local: ${new Date(dbTime).toString()}`);
    console.log(`   - Epoch: ${new Date(dbTime).getTime()}`);
  } catch (err) {
    console.error('Không lấy được giờ DB:', err.message);
  }

}

main().catch(console.error).finally(() => prisma.$disconnect());
