/**
 * debug-storage.mjs
 * Chạy: node --env-file=.env debug-storage.mjs
 * Mục đích: Kiểm tra tình trạng FTP và thử tải ảnh Zalo về
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import ftp from 'basic-ftp';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('❌ Thiếu DATABASE_URL trong .env!');
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('\n==================================================');
  console.log(' OMNI360 STORAGE DEBUGGER');
  console.log('==================================================\n');

  // 1. Kiểm tra cấu hình FTP đang active
  console.log('[1] Kiểm tra cấu hình FTP trong DB...');
  const allConfigs = await prisma.storageConfig.findMany({
    select: { id: true, name: true, type: true, host: true, user: true, port: true, isActive: true, orgId: true }
  });
  
  if (allConfigs.length === 0) {
    console.log('  ❌ KHÔNG CÓ cấu hình storage nào trong DB!');
    console.log('  → Hệ thống đang dùng LOCAL storage.');
  } else {
    allConfigs.forEach(c => {
      const status = c.isActive ? '✅ ACTIVE' : '⬜ inactive';
      console.log(`  ${status} | ${c.name} | ${c.type} | host: ${c.host}:${c.port} | orgId: ${c.orgId || 'null (global)'}`);
    });
  }

  const activeConfig = await prisma.storageConfig.findFirst({ where: { isActive: true } });
  if (!activeConfig) {
    console.log('\n  ❌ KHÔNG có FTP nào đang ACTIVE! Đây là nguyên nhân chính.');
    console.log('  → Vào trang Super Admin, bật toggle để kích hoạt FTP01.\n');
  } else {
    console.log(`\n  ✅ FTP đang ACTIVE: ${activeConfig.name} (${activeConfig.host})`);
  }

  // 2. Kiểm tra 5 tin nhắn ảnh gần nhất
  console.log('\n[2] 5 tin nhắn ảnh/file gần nhất...');
  const recentMedia = await prisma.message.findMany({
    where: {
      contentType: { in: ['image', 'photo', 'chat.photo', 'file', 'chat.file', 'video', 'gif'] }
    },
    select: { id: true, contentType: true, fileStatus: true, content: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (recentMedia.length === 0) {
    console.log('  Không có tin nhắn media nào.');
  }

  recentMedia.forEach(m => {
    let urlPreview = '';
    try {
      const p = JSON.parse(m.content || '{}');
      urlPreview = (p.href || p.url || p.thumb || '').substring(0, 80);
    } catch {}
    const statusIcon = m.fileStatus === 'success' ? '✅' : m.fileStatus === 'failed' ? '❌' : m.fileStatus === 'pending' ? '⏳' : '⬜';
    console.log(`  ${statusIcon} [${m.fileStatus || 'null'}] ${m.contentType}`);
    console.log(`     id: ${m.id}`);
    console.log(`     time: ${m.createdAt.toISOString()}`);
    console.log(`     url: ${urlPreview || '(trống hoặc không phải URL)'}`);
  });

  // 3. Kiểm tra kết nối FTP trực tiếp
  if (activeConfig && activeConfig.type === 'ftp') {
    console.log(`\n[3] Kiểm tra kết nối FTP: ${activeConfig.host}:${activeConfig.port}...`);
    const client = new ftp.Client();
    client.ftp.verbose = false;
    try {
      await client.access({
        host: activeConfig.host,
        user: activeConfig.user,
        password: activeConfig.password,
        port: activeConfig.port,
        secure: false
      });
      console.log('  ✅ Kết nối FTP thành công!');
      const list = await client.list('/');
      console.log(`  📁 Thư mục gốc: ${list.slice(0, 5).map(f => f.name).join(', ')}`);
    } catch (err) {
      console.log(`  ❌ Lỗi kết nối FTP: ${err.message}`);
      console.log('  → Kiểm tra lại host, user, password, port trong Super Admin.');
    } finally {
      client.close();
    }
  } else {
    console.log('\n[3] Bỏ qua kiểm tra FTP (không có config active hoặc không phải FTP type).');
  }

  // 4. Thử download 1 ảnh Zalo CDN
  console.log('\n[4] Thử tải ảnh Zalo CDN với browser headers...');
  // Dùng ảnh công khai từ Zalo để test
  const testUrl = 'https://s120-ava-talk.zadn.vn/a/e/0/9/8/120/0da50a3e14dcaeb9e0be8e77d19614db.jpg';
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(testUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://chat.zalo.me/',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      }
    });
    clearTimeout(t);
    console.log(`  HTTP Status: ${res.status} ${res.statusText}`);
    if (res.ok) {
      const buf = await res.arrayBuffer();
      console.log(`  ✅ Tải Zalo CDN thành công! Kích thước: ${(buf.byteLength / 1024).toFixed(1)} KB`);
    } else {
      console.log(`  ⚠️  HTTP ${res.status} — Zalo CDN trả về lỗi.`);
    }
  } catch (err) {
    console.log(`  ❌ Lỗi fetch: ${err.message}`);
  }

  // 5. Thống kê fileStatus 24h
  console.log('\n[5] Thống kê fileStatus 24h qua...');
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const stats = await prisma.message.groupBy({
    by: ['fileStatus', 'contentType'],
    where: {
      contentType: { in: ['image', 'photo', 'chat.photo', 'file', 'chat.file', 'video'] },
      createdAt: { gte: since }
    },
    _count: { id: true }
  });
  
  if (stats.length === 0) {
    console.log('  Không có tin nhắn media nào trong 24h qua.');
  } else {
    stats.forEach(s => {
      const icon = s.fileStatus === 'success' ? '✅' : s.fileStatus === 'failed' ? '❌' : '⬜';
      console.log(`  ${icon} ${s.contentType} | fileStatus="${s.fileStatus}" | count=${s._count.id}`);
    });
  }

  console.log('\n==================================================');
  console.log(' CHẨN ĐOÁN HOÀN TẤT');
  console.log('==================================================\n');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
