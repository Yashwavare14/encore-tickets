import sql from '../src/db/client';
import { seedDatabase } from '../src/db/seed';

async function main() {
  try {
    await seedDatabase({ resetAll: true });
    await sql.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    await sql.end();
    process.exit(1);
  }
}

main();
