import 'dotenv/config';
import { prisma } from './shared/database/prisma-client.js';
import { logger } from './shared/utils/logger.js';

async function runMigration() {
  logger.info('[MIGRATION] Starting database migration...');
  try {
    // 1. Copy values from crm_name to admin_customer_id where admin_customer_id is null/empty
    const copyCount = await prisma.$executeRawUnsafe(
      `UPDATE contacts 
       SET admin_customer_id = crm_name 
       WHERE (admin_customer_id IS NULL OR admin_customer_id = '') 
         AND crm_name IS NOT NULL 
         AND crm_name != ''`
    );
    logger.info(`[MIGRATION] Copied crm_name to admin_customer_id for ${copyCount} contact(s).`);

    // 2. Clear crm_name for all contacts
    const clearCount = await prisma.$executeRawUnsafe(
      `UPDATE contacts 
       SET crm_name = NULL 
       WHERE crm_name IS NOT NULL`
    );
    logger.info(`[MIGRATION] Cleared crm_name field for ${clearCount} contact(s).`);

    logger.info('[MIGRATION] Database migration completed successfully!');
  } catch (err: any) {
    logger.error('[MIGRATION] Migration failed:', err.message || err);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

runMigration();
