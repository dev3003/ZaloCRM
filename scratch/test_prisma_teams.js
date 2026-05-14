const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
  try {
    console.log('Testing prisma.team.findMany...');
    const teams = await prisma.team.findMany({
      include: {
        users: { select: { id: true, fullName: true, email: true, role: true } },
        leader: { select: { id: true, fullName: true, email: true } },
      },
    });
    console.log('Success! Found teams:', teams.length);
    if (teams.length > 0) {
       console.log('Example team:', JSON.stringify(teams[0], null, 2));
    }
  } catch (err) {
    console.error('ERROR in Prisma query:', err);
  } finally {
    await prisma.$disconnect();
  }
}

test();
