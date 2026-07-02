import { prisma } from '../../shared/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

export class ErpSyncService {
  /**
   * Sync customer-sale assignments from ERP API
   */
  static async syncAssignments(orgId: string) {
    try {
      // 1. Get ERP API config from settings (Assuming you'll provide the URL)
      const setting = await prisma.appSetting.findUnique({
        where: { orgId_settingKey: { orgId, settingKey: 'erp_api_url' } }
      });
      
      const erpApiUrl = setting?.valuePlain;
      if (!erpApiUrl) {
        throw new Error('ERP API URL not configured in settings');
      }

      const keySetting = await prisma.appSetting.findUnique({
        where: { orgId_settingKey: { orgId, settingKey: 'erp_api_key' } }
      });
      const erpApiKey = keySetting?.valuePlain;

      logger.info(`[ERP-SYNC] Starting sync for org ${orgId} from ${erpApiUrl}`);

      // 2. Fetch data from ERP with Security Header
      const response = await fetch(erpApiUrl, {
        headers: {
          'X-API-KEY': erpApiKey || '',
          'Accept': 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`ERP API error: ${response.statusText}`);
      }
      const erpData = await response.json() as any[];

      if (!Array.isArray(erpData)) {
        throw new Error('Invalid ERP data format: expected an array');
      }

      // 2.5 Migration: Move values from crm_name to admin_customer_id if missing or empty
      const migratedCount = await prisma.$executeRawUnsafe(
        "UPDATE contacts SET admin_customer_id = crm_name WHERE org_id = $1 AND (admin_customer_id IS NULL OR admin_customer_id = '') AND crm_name IS NOT NULL AND crm_name != ''",
        orgId
      );
      if (migratedCount > 0) {
        logger.info(`[ERP-SYNC] Migrated ${migratedCount} contacts from crm_name to admin_customer_id`);
      }

      // 2.6 Debug: Count total contacts in this org
      const totalContacts = await prisma.contact.count({ where: { orgId } });
      logger.info(`[ERP-SYNC] Total contacts in org ${orgId}: ${totalContacts}`);

      let successCount = 0;
      let failCount = 0;

      // 3. Process each assignment
      for (const item of erpData) {
        const erpCustomerId = String(item.customer_id || item.admin_customer_id || '');
        const erpSaleId = String(item.sale_id || item.admin_sale_id || '');

        if (!erpCustomerId || !erpSaleId) {
          logger.warn(`[ERP-SYNC] Missing ID in item: ${JSON.stringify(item)}`);
          continue;
        }

        try {
          logger.info(`[ERP-SYNC] Processing: Customer ${erpCustomerId} -> Sale ${erpSaleId}`);

          // Find the user (sale) in Omni360
          const user = await prisma.user.findFirst({
            where: { orgId, adminSaleId: erpSaleId }
          });

          if (!user) {
            logger.warn(`[ERP-SYNC] Sale not found in DB with adminSaleId: ${erpSaleId}`);
            failCount++;
            continue;
          }

          // Update all contacts matching this ERP ID
          const result = await prisma.contact.updateMany({
            where: { 
              orgId, 
              adminCustomerId: erpCustomerId
            },
            data: { assignedUserId: user.id }
          });

          if (result.count > 0) {
            logger.info(`[ERP-SYNC] Successfully assigned ${result.count} contact(s) to user ${user.email}`);
            successCount++;
          } else {
            logger.warn(`[ERP-SYNC] No contact found in DB with ID: ${erpCustomerId} (checked adminCustomerId)`);
            failCount++;
          }
        } catch (err) {
          logger.error(`[ERP-SYNC] Error processing item ${erpCustomerId}:`, err);
          failCount++;
        }
      }

      logger.info(`[ERP-SYNC] Sync completed. Success: ${successCount}, Failed: ${failCount}`);
      return { successCount, failCount };
    } catch (err: any) {
      logger.error('[ERP-SYNC] Sync failed:', err.message);
      throw err;
    }
  }
}
