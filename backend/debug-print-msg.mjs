import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const msg = await prisma.message.findUnique({
    where: { id: '8ead4e22-ae4a-4af3-b671-4303864c51ef' }
  });
  console.log('--- Message Details ---');
  console.log(JSON.stringify(msg, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
