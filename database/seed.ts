import { existsSync } from 'node:fs';
import pg from 'pg';
import { DEMO_PASSWORD, DEMO_USERS, seed } from './seed-data.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
await seed(client);
await client.end();
console.log(`Seeded synthetic data. Demo password for all accounts: ${DEMO_PASSWORD}`);
for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(9)} ${u.email}`);
