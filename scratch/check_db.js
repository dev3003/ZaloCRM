import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const accounts = await prisma.zaloAccount.findMany();
  console.log('Zalo Accounts:', accounts.map(a => ({ id: a.id, name: a.displayName, uid: a.zaloUid })));

  const groups = await prisma.conversation.findMany({
    where: { threadType: 'group' },
    select: {
      id: true,
      externalThreadId: true,
      zaloAccountId: true,
      lastMemberSyncAt: true,
      groupMembers: {
        include: {
          contact: true
        }
      }
    }
  });

  console.log('Group Conversations:');
  for (const g of groups) {
    console.log(`- ID: ${g.id}`);
    console.log(`  External ID: ${g.externalThreadId}`);
    console.log(`  Zalo Account ID: ${g.zaloAccountId}`);
    console.log(`  Last Member Sync At: ${g.lastMemberSyncAt}`);
    console.log(`  Member Count in DB: ${g.groupMembers.length}`);
    console.log(`  Members:`, g.groupMembers.map(m => m.contact.fullName));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
