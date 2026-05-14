const fs = require('fs');
const path = 'c:/laragon/www/ZaloCRM/backend/src/modules/contacts/contact-routes.ts';
let content = fs.readFileSync(path, 'utf8');

// Replace all occurrences of the old leader check pattern
const oldPattern = /} else if \(user\.role === 'leader' && user\.teamId\) {/g;
content = content.replace(oldPattern, "} else if (user.role === 'leader') {");

// Replace member-teamId filtering with leaderId relation filtering
const oldFieldPattern = /{ teamId: user\.teamId }/g;
content = content.replace(oldFieldPattern, "{ team: { leaderId: user.id } }");

fs.writeFileSync(path, content, 'utf8');
console.log('Successfully updated contact-routes.ts');
