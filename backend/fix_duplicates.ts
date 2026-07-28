import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const messages = await prisma.message.findMany({
    where: { senderType: 'self' },
    orderBy: { sentAt: 'asc' },
    select: { id: true, content: true, conversationId: true, sentAt: true }
  });
  const seen = new Set();
  let deleted = 0;
  for (const m of messages) {
    const key = `${m.conversationId}-${m.content}-${m.sentAt.getTime()}`;
    if (seen.has(key)) {
      await prisma.message.delete({ where: { id: m.id } });
      deleted++;
    } else {
      seen.add(key);
    }
  }
  console.log(`Deleted ${deleted} duplicate messages`);
}
main().finally(() => prisma.$disconnect());
