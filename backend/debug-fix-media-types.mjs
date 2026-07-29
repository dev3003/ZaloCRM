import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n===== SỬA LỖI LOẠI TIN NHẮN MEDIA BỊ NHẬN DIỆN NHẦM THÀNH TEXT =====\n');

  // Tìm các tin nhắn có dạng JSON chứa link Zalo ảnh/file trong vòng 7 ngày qua
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const messages = await prisma.message.findMany({
    where: {
      createdAt: { gte: since },
      contentType: 'text',
      content: {
        contains: 'zdn.vn'
      }
    }
  });

  console.log(`Tìm thấy ${messages.length} tin nhắn bị nhận diện nhầm.`);

  let updatedCount = 0;
  for (const msg of messages) {
    try {
      const parsed = JSON.parse(msg.content);
      const href = String(parsed.href || parsed.url || '');
      const thumb = String(parsed.thumb || '');
      const isZaloImage = (url) => 
        url.includes('zdn.vn') && 
        (url.includes('/jpg/') || url.includes('/png/') || url.includes('/webp/') || url.includes('photo-stal') || url.includes('photo.stal'));

      if (isZaloImage(href) || isZaloImage(thumb)) {
        console.log(`- Cập nhật tin nhắn ${msg.id}: loại 'text' -> 'image', fileStatus -> 'pending'`);
        await prisma.message.update({
          where: { id: msg.id },
          data: {
            contentType: 'image',
            fileStatus: 'pending'
          }
        });
        updatedCount++;
      }
    } catch (e) {
      // Bỏ qua tin nhắn không phải JSON
    }
  }

  console.log(`\nĐã cập nhật thành công ${updatedCount} tin nhắn media sang trạng thái 'pending'.`);
  console.log('Hệ thống Storage Cron sẽ quét và tải các tin nhắn này lên FTP trong vòng 1 phút tới.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
