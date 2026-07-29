import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n===== KIỂM TRA TRẠNG THÁI AGENT TRONG DB =====\n');
  const agents = await prisma.zaloDesktopAgent.findMany({
    orderBy: { updatedAt: 'desc' }
  });

  if (agents.length === 0) {
    console.log('Không tìm thấy bản ghi Agent nào.');
  }

  agents.forEach(a => {
    console.log(`- Agent ID: ${a.id}`);
    console.log(`  Tên máy: ${a.computerName || 'N/A'}`);
    console.log(`  IP: ${a.ipAddress || 'N/A'}`);
    console.log(`  Trạng thái: ${a.status} (Cập nhật: ${a.updatedAt.toISOString()})`);
    console.log(`  OrgId: ${a.orgId}`);
    console.log('');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
