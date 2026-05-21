import 'dotenv/config';
import { detectDuplicates } from './src/modules/contacts/duplicate-detector.js';

async function run() {
  console.log('Running duplicate detector...');
  await detectDuplicates();
  console.log('Done!');
  process.exit(0);
}

run().catch(console.error);
