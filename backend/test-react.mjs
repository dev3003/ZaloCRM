import { prisma } from './src/shared/database/prisma-client.js';
import { zaloPool } from './src/modules/zalo/zalo-pool.js';

async function test() {
  const account = await prisma.zaloAccount.findFirst({ where: { status: 'connected' } });
  if (!account) return console.log("No connected account");
  
  const instance = zaloPool.getInstance(account.id);
  if (!instance?.api) {
     // try to connect
     console.log("Reconnecting...");
     if (account.sessionData) {
        await zaloPool.reconnect(account.id, account.sessionData);
     }
  }
  const api = zaloPool.getInstance(account.id)?.api;
  if (!api) return console.log("Still no API");
  
  // Find a recent message with zaloMsgId
  const msg = await prisma.message.findFirst({
    where: { zaloMsgId: { not: null } },
    orderBy: { createdAt: 'desc' }
  });
  if (!msg) return console.log("No message found");
  
  const conv = await prisma.conversation.findUnique({ where: { id: msg.conversationId } });
  
  console.log(`Reacting to gMsgID: ${msg.zaloMsgId}`);
  try {
    const res = await api.addReaction('/-heart', {
      data: {
        msgId: msg.zaloMsgId,
        cliMsgId: msg.zaloMsgId // wrong cliMsgId
      },
      threadId: conv.externalThreadId,
      type: conv.threadType === 'group' ? 1 : 0
    });
    console.log("Reaction SUCCESS!", res);
  } catch (err) {
    console.log("Reaction FAILED!", err);
  }
}

test().catch(console.error).finally(() => { process.exit(0); });
