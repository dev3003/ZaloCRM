/**
 * debug-find-message.mjs
 * Tìm tin nhắn lúc 14h51 và kiểm tra contentType thực tế
 * Chạy: node --env-file=.env debug-find-message.mjs
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const since = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 giờ gần nhất

  console.log('\n===== TÌM TIN NHẮN MEDIA 2H GẦN NHẤT (MỌI CONTENTTYPE) =====\n');

  // Lấy TẤT CẢ tin nhắn trong 2h, không lọc contentType
  const all = await prisma.message.findMany({
    where: { createdAt: { gte: since }, contentType: { not: 'text' } },
    select: { id: true, contentType: true, fileStatus: true, content: true, createdAt: true, senderType: true },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  if (all.length === 0) {
    console.log('Không có tin nhắn non-text nào trong 2h qua!');
  }

  all.forEach(m => {
    let urlPreview = '(không phải JSON hoặc trống)';
    try {
      const p = JSON.parse(m.content || '{}');
      const url = p.href || p.url || p.thumb || p.hd || '';
      urlPreview = url ? url.substring(0, 90) : '(không tìm thấy URL)';
    } catch {
      if (m.content?.startsWith('http')) urlPreview = m.content.substring(0, 90);
    }
    
    const timeVN = new Date(m.createdAt.getTime() + 7 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);
    const statusIcon = m.fileStatus === 'success' ? '✅' : m.fileStatus === 'failed' ? '❌' : m.fileStatus === 'pending' ? '⏳' : '⬜';
    
    console.log(`${statusIcon} ${timeVN} VN | ${m.senderType} | contentType: "${m.contentType}" | fileStatus: "${m.fileStatus}"`);
    console.log(`   id: ${m.id}`);
    console.log(`   url: ${urlPreview}`);
    console.log('');
  });

  // Kiểm tra xem tin nhắn 14h51 có fileStatus=failed cần retry không
  const failedCount = await prisma.message.count({
    where: {
      fileStatus: 'failed',
      createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
    }
  });
  console.log(`===== TIN NHẮN CÓ fileStatus=failed (24h): ${failedCount} =====`);

  // Force retry tất cả failed messages trong 24h
  if (failedCount > 0) {
    console.log('\nĐặt lại fileStatus về "pending" để cron retry...');
    const updated = await prisma.message.updateMany({
      where: {
        fileStatus: 'failed',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      data: { fileStatus: 'pending' }
    });
    console.log(`✅ Đã reset ${updated.count} tin nhắn → pending (cron sẽ retry trong 1 phút)`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
