import postgres from 'postgres';
import * as dotenv from 'dotenv';
import path from 'path';

// Load .env.local or .env for standalone scripts and background jobs
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL or DATABASE_URL_UNPOOLED environment variable is not defined.'
  );
}

// Global postgres client singleton to prevent excessive connections during Next.js hot-reloads
declare global {
  // eslint-disable-next-line no-var
  var __postgresSql: postgres.Sql | undefined;
}

export const sql =
  global.__postgresSql ||
  postgres(connectionString, {
    ssl: 'require',
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });

if (process.env.NODE_ENV !== 'production') {
  global.__postgresSql = sql;
}

export default sql;
