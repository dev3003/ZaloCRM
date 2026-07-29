import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const query = 'fb878c0379f5beabe7e4';
  console.log(`\n===== TÌM TIN NHẮN CHỨA: ${query} =====\n`);

  const msgs = await prisma.message.findMany({
    where: {
      content: {
        contains: query
      }
    }
  });

  if (msgs.length === 0) {
    console.log('Không tìm thấy tin nhắn nào.');
    return;
  }

  msgs.forEach(m => {
    console.log(`ID: ${m.id}`);
    console.log(`Kiểu: ${m.contentType}`);
    console.log(`FileStatus: ${m.fileStatus}`);
    console.log(`Content: ${m.content}`);
    console.log(`createdAt: ${m.createdAt.toISOString()}`);
    console.log('');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
