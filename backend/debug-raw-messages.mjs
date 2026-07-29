import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n===== 10 TIN NHẮN MỚI NHẤT TRONG DB (KHÔNG LỌC THỜI GIAN) =====\n');
  
  const msgs = await prisma.message.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' }
  });

  if (msgs.length === 0) {
    console.log('Không có tin nhắn nào trong DB.');
    return;
  }

  msgs.forEach(m => {
    console.log(`ID: ${m.id}`);
    console.log(`Người gửi: ${m.senderType} (${m.senderName || 'N/A'})`);
    console.log(`Loại: ${m.contentType}`);
    console.log(`Trạng thái File: ${m.fileStatus}`);
    console.log(`createdAt (DB Raw): ${m.createdAt.toISOString()}`);
    console.log(`sentAt (Zalo Raw):  ${m.sentAt.toISOString()}`);
    console.log(`Nội dung: ${m.content.substring(0, 200)}`);
    console.log('--------------------------------------------------\n');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
