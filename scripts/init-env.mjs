// Creates .env from .env.example with fresh random secrets. Never overwrites.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (!existsSync('.env')) {
  const filled = readFileSync('.env.example', 'utf8').replace(
    /^(STATE_SIGNING_SECRET|MOCK_PROVIDER_SECRET)=\s*$/gm,
    (_line, key) => `${key}=${randomBytes(32).toString('hex')}`,
  );
  writeFileSync('.env', filled);
  console.log('Created .env with random local secrets.');
} else {
  console.log('.env already exists, left unchanged.');
}
