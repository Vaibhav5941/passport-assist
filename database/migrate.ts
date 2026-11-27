// Minimal forward-only SQL migrator. Each file runs once, inside a transaction.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. Run "npm run setup".');

async function createDatabaseIfMissing(target: string) {
  const admin = new URL(target);
  const name = admin.pathname.slice(1);
  if (!/^\w+$/.test(name)) throw new Error('Unsupported database name');
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!found.rowCount) await client.query(`CREATE DATABASE ${name}`);
  await client.end();
}

if (process.argv.includes('--create')) await createDatabaseIfMissing(url);

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query('SELECT pg_advisory_lock(74201)');
  await client.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const file of readdirSync('database/migrations').filter((f) => f.endsWith('.sql')).sort()) {
    const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (done.rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(readFileSync(`database/migrations/${file}`, 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log('Database is up to date.');
} finally {
  await client.end();
}
