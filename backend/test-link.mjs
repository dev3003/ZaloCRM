import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function main() {
  const s = await prisma.appSetting.findFirst({where: {settingKey: 'erp_decrypt_key'}});
  if(!s) {
    console.log('No key found in app settings');
    return;
  }
  
  const key = s.valuePlain;
  const phone = '0987654321'; // Dummy phone number
  
  const keyBuf = Buffer.from(key.substring(0, 16), 'utf8');
  const iv = Buffer.from(key.substring(0, 16), 'utf8');
  const cipher = crypto.createCipheriv('aes-128-cbc', keyBuf, iv);
  const encrypted = cipher.update(phone, 'utf8', 'base64') + cipher.final('base64');
  
  const cid = 'KH001';
  const sid = 'SALE001';
  
  const url = `http://localhost:5173/chat?cid=${cid}&sid=${sid}&phone=${encodeURIComponent(encrypted)}`;
  
  console.log('--- TEST DATA ---');
  console.log('Encryption Key:', key);
  console.log('Phone:', phone);
  console.log('Encrypted Phone:', encrypted);
  console.log('URLEncoded Phone:', encodeURIComponent(encrypted));
  console.log('Test URL:', url);
}

main().finally(() => prisma.$disconnect());
