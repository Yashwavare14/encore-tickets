import fs from 'fs';
import path from 'path';
import sql from '../src/db/client';

export async function runMigrations() {
  console.log('🔄 Running database migrations on Neon Postgres...');
  const schemaPath = path.resolve(__dirname, '../src/db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  try {
    await sql.unsafe(schemaSql);
    console.log('✅ Migrations executed successfully! All tables and indexes are ready.');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

if (require.main === module || process.argv[1]?.includes('migrate')) {
  runMigrations()
    .then(async () => {
      await sql.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(err);
      await sql.end();
      process.exit(1);
    });
}
