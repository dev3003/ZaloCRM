import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const config = await prisma.storageConfig.findUnique({
    where: { id: '7b350d14-5acb-4071-b488-893d995762fd' }
  });
  console.log(config);
}
main();
