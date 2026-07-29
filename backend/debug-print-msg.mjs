import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const msgs = await prisma.message.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  });
  console.log('--- Message Details ---');
  console.log(JSON.stringify(msgs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
