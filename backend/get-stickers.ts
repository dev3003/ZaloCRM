import { PrismaClient } from '@prisma/client';
import { zaloPool } from './src/modules/zalo/zalo-pool.js';
import * as dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

async function main() {
  const account = await prisma.zaloAccount.findFirst({ where: { status: 'connected' } });
  if (!account) return console.log('No connected account');
  
  // wait for pool to initialize
  await new Promise(r => setTimeout(r, 2000));
  
  const instance = zaloPool.getInstance(account.id);
  if (!instance || !instance.api) return console.log('No instance API');

  try {
    const sugg = await instance.api.getStickers('hello');
    console.log('Suggested IDs:', sugg);
    if (sugg && sugg.length > 0) {
       const details = await instance.api.getStickersDetail(sugg.slice(0, 10));
       console.log('Sticker Details:', JSON.stringify(details, null, 2));
    }
  } catch (err) {
    console.error('Error fetching stickers:', err);
  }
}
main().finally(() => process.exit(0));
