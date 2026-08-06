import { readFileSync } from 'fs';
import { join } from 'path';

// Parse .env manually
const envPath = join(process.cwd(), '.env');
const envContent = readFileSync(envPath, 'utf8');
for (const line of envContent.split('\n')) {
  if (line && !line.startsWith('#') && line.includes('=')) {
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim().replace(/^["']|["']$/g, '');
    process.env[key.trim()] = value;
  }
}

// Now import prisma from dist
const { prisma } = await import('./dist/shared/database/prisma-client.js');

async function main() {
  const teams = await prisma.team.findMany({
    include: {
      leader: {
        select: { id: true, email: true, fullName: true, role: true }
      },
      users: {
        select: { id: true, email: true, fullName: true, role: true }
      }
    }
  });

  console.log('--- TEAMS IN DATABASE ---');
  for (const team of teams) {
    console.log(`Team: ${team.name} (ID: ${team.id})`);
    console.log(`Leader: ${team.leader ? `${team.leader.fullName} (${team.leader.email}, Role: ${team.leader.role})` : 'None'}`);
    console.log(`Tags:`, team.tags);
    console.log(`Members count: ${team.users.length}`);
    for (const member of team.users) {
      console.log(` - ${member.fullName} (${member.email}, Role: ${member.role})`);
    }
    console.log('-------------------------');
  }

  const leaders = await prisma.user.findMany({
    where: { role: 'leader' },
    include: {
      team: true
    }
  });
  console.log('\n--- USERS WITH ROLE LEADER ---');
  for (const l of leaders) {
    console.log(`User: ${l.fullName} (${l.email})`);
    console.log(`Associated Team in User.teamId: ${l.teamId ? `${l.team?.name} (ID: ${l.team?.id})` : 'None'}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
