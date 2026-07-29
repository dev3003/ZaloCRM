import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const since = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1 hour ago
  console.log('\n===== ALL MESSAGES IN LAST 1 HOUR =====\n');
  const msgs = await prisma.message.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' }
  });

  if (msgs.length === 0) {
    console.log('No messages found in the last 1 hour.');
  }

  msgs.forEach(m => {
    const timeVN = new Date(m.createdAt.getTime() + 7 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${m.fileStatus || 'null'}] ${timeVN} VN | ${m.senderType} | type: ${m.contentType} | id: ${m.id}`);
    console.log(`Content: ${m.content}`);
    console.log('');
  });
}

main().catch(console.error).finally(() => prisma.$disconnect());
