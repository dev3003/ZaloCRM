import { prisma } from '../backend/src/shared/database/prisma-client.js';

async function main() {
  const accounts = await prisma.zaloAccount.findMany();
  console.log('Zalo Accounts:', accounts.map(a => ({ id: a.id, name: a.displayName, uid: a.zaloUid })));

  const conversations = await prisma.conversation.findMany();
  console.log(`Total Conversations in DB: ${conversations.length}`);
  console.log('Types of conversations:', conversations.reduce((acc: any, c) => {
    acc[c.threadType] = (acc[c.threadType] || 0) + 1;
    return acc;
  }, {}));

  const groups = await prisma.conversation.findMany({
    where: { threadType: 'group' },
    select: {
      id: true,
      externalThreadId: true,
      zaloAccountId: true,
      lastMemberSyncAt: true,
      members: {
        include: {
          contact: true
        }
      }
    }
  });

  console.log('Group Conversations detail:');
  for (const g of groups) {
    console.log(`- ID: ${g.id}`);
    console.log(`  External ID: ${g.externalThreadId}`);
    console.log(`  Zalo Account ID: ${g.zaloAccountId}`);
    console.log(`  Last Member Sync At: ${g.lastMemberSyncAt}`);
    console.log(`  Member Count in DB: ${g.members.length}`);
    console.log(`  Members:`, g.members.map(m => m.contact.fullName));
  }
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
