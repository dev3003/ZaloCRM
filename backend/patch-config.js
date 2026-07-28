import fs from 'fs';
let content = fs.readFileSync('backend/src/config/index.ts', 'utf8');
if (!content.includes('apiUrl:')) {
  content = content.replace("appUrl: process.env.APP_URL || 'http://localhost:3000',", "appUrl: process.env.APP_URL || 'http://localhost:3000',\n  apiUrl: process.env.API_URL || 'http://localhost:3000',");
  fs.writeFileSync('backend/src/config/index.ts', content);
  console.log('Patched config');
}
