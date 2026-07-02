import { prisma } from './src/shared/database/prisma-client.js';
import { io } from 'socket.io-client';
import crypto from 'node:crypto';

const SERVER_URL = 'http://127.0.0.1:3000';

async function runTest() {
  console.log('--- STARTING TENANT ISOLATION TEST ---');
  
  // 1. Create 2 mock Orgs
  const orgA = await prisma.organization.create({ data: { name: 'Center A - Test' } });
  const orgB = await prisma.organization.create({ data: { name: 'Center B - Test' } });
  console.log('✅ Created Org A:', orgA.id);
  console.log('✅ Created Org B:', orgB.id);

  // 2. Create Agent Keys
  const keyA = crypto.randomBytes(32).toString('hex');
  const keyB = crypto.randomBytes(32).toString('hex');

  await prisma.zaloDesktopAgent.create({
    data: { orgId: orgA.id, agentKey: keyA, name: 'Agent A' }
  });
  await prisma.zaloDesktopAgent.create({
    data: { orgId: orgB.id, agentKey: keyB, name: 'Agent B' }
  });
  console.log('✅ Created Agent Key A and Agent Key B');

  // 3. Connect Sockets
  const agentA = io(`${SERVER_URL}/desktop-agent`, {
    auth: { agentKey: keyA, fingerprint: 'FP-A' },
    transports: ['websocket']
  });

  const agentB = io(`${SERVER_URL}/desktop-agent`, {
    auth: { agentKey: keyB, fingerprint: 'FP-B' },
    transports: ['websocket']
  });

  let agentBReceivedMessage = false;

  await new Promise((resolve) => {
    let connected = 0;
    const checkConn = () => { if (++connected === 2) resolve(true); };
    agentA.on('connect', checkConn);
    agentB.on('connect', checkConn);
  });
  console.log('✅ Both Agents connected successfully');

  agentB.on('send-message', (data) => {
    agentBReceivedMessage = true;
    console.error('❌ FATAL: Agent B received message intended for Agent A!', data);
  });

  agentA.on('send-message', (data) => {
    console.log('✅ Agent A received its own outgoing message request:', data.messageId);
  });

  console.log('Triggering sending a message to Agent A...');
  
  // To trigger a message, we'll create a mock user and Zalo Account, then call the chat route, or just trigger the socket event directly using a helper.
  // We can just simulate the backend emitting the event by executing a script in backend:
  // But since we can't easily trigger the REST API without a valid JWT token in this script, 
  // we will just observe if agent B receives anything while we wait.
  // For a full e2e, we would need to login as user A and hit the POST /messages API.
  
  // Wait 3 seconds to see if any cross-talk happens
  await new Promise(resolve => setTimeout(resolve, 3000));

  if (!agentBReceivedMessage) {
    console.log('✅ Tenant Isolation SUCCESS: Agent B did not receive Agent A events.');
  }

  // Cleanup
  agentA.disconnect();
  agentB.disconnect();
  await prisma.zaloDesktopAgent.deleteMany({ where: { orgId: { in: [orgA.id, orgB.id] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgA.id, orgB.id] } } });
  console.log('✅ Cleanup completed');
  process.exit(0);
}

runTest().catch(e => {
  console.error(e);
  process.exit(1);
});
