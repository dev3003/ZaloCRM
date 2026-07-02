import { logger } from '../../shared/utils/logger.js';
import { detectDuplicates } from './duplicate-detector.js';

export async function runContactIntelligence(): Promise<void> {
  logger.info('[intelligence] Manual run started (detect duplicates)...');
  await detectDuplicates();
  logger.info('[intelligence] Manual run completed');
}

