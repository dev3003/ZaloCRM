import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n===== KIỂM TRA TRẠNG THÁI TÀI KHOẢN ZALO TRONG DB =====\n');
  const accounts = await prisma.zaloAccount.findMany({
    orderBy: { updatedAt: 'desc' }
  });

  if (accounts.length === 0) {
    console.log('Không tìm thấy tài khoản Zalo nào.');
  }

  accounts.forEach(a => {
    console.log(`- Tài khoản: ${a.displayName} (UID: ${a.zaloUid || 'N/A'})`);
    console.log(`  ID: ${a.id}`);
    console.log(`  Trạng thái kết nối: ${a.status}`);
    console.log(`  Cập nhật lúc: ${a.updatedAt.toISOString()}`);
    console.log('');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
