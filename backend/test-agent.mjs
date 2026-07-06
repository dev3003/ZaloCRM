import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const agents = await prisma.zaloDesktopAgent.findMany({ where: { status: 'active' } });
  console.log("Active agents:", agents.length);
}
main().catch(console.error).finally(() => prisma.$disconnect());
