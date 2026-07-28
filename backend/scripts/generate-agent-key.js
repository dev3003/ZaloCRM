import 'dotenv/config';
import { prisma } from '../src/shared/database/prisma-client.ts';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
async function main() {
  console.log('Đang kết nối Database...');
  
  const org = await prisma.organization.findFirst();
  if (!org) {
    console.log('❌ Không tìm thấy tổ chức nào trong Database. Vui lòng tạo tài khoản trên CRM trước.');
    process.exit(1);
  }
  
  console.log(`✅ Đã tìm thấy Tổ chức: ${org.name}`);

  let agent = await prisma.zaloDesktopAgent.findFirst({
    where: { orgId: org.id }
  });

  let agentKey;
  if (agent) {
    agentKey = agent.agentKey;
    console.log('✅ Đã lấy Agent Key có sẵn trong hệ thống.');
  } else {
    agentKey = crypto.randomBytes(32).toString('hex');
    await prisma.zaloDesktopAgent.create({
      data: {
        id: uuidv4(),
        orgId: org.id,
        name: 'Main Server (Auto Generated)',
        agentKey: agentKey,
        status: 'active'
      }
    });
    console.log('✅ Đã tạo Agent Key MỚI thành công.');
  }

  console.log('\n==================================================');
  console.log('🔑 AGENT_KEY CỦA BẠN LÀ:');
  console.log(agentKey);
  console.log('==================================================\n');
}

main()
  .catch(e => {
    console.error('❌ Lỗi kết nối Database:', e.message);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
