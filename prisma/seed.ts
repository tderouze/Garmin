import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: {},
    create: {
      email: 'demo@example.com',
    },
  });

  console.log(`Seed: user ${user.id} (${user.email})`);

  // Optional demo activity if none exists
  const count = await prisma.activity.count({ where: { userId: user.id } });
  if (count === 0) {
    const activity = await prisma.activity.create({
      data: {
        userId: user.id,
        type: 'running',
        name: 'Demo Run',
        date: new Date(),
        distance: 10000,
        duration: 3000,
        elevationGain: 120,
        avgPace: 300,
        avgHR: 155,
        maxHR: 178,
        hasGps: true,
        laps: {
          create: [{ idx: 0, distance: 10000, duration: 3000, avgPace: 300, avgHR: 155 }],
        },
      },
    });
    console.log(`Seed: activity ${activity.id}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
