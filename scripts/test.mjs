// Single test command: prepares the isolated test database, then runs Vitest.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) {
  console.error('TEST_DATABASE_URL must be set and its database name must end in "_test".');
  process.exit(1);
}
const env = {
  ...process.env,
  DATABASE_URL: url,
  NODE_ENV: 'test',
  DEMO_MODE: 'true',
  STATE_SIGNING_SECRET: 'test-only-state-secret-0123456789abcdef',
  MOCK_PROVIDER_SECRET: 'test-only-provider-secret-0123456789abc',
};
const run = (cmd) => execSync(cmd, { stdio: 'inherit', env });
try {
  run('npx tsx database/migrate.ts --create');
  run('npx vitest run --config backend/vitest.config.ts');
} catch {
  process.exit(1);
}
