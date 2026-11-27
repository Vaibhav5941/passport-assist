import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

function required(name: string, minLength = 1): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    // The value itself is never printed.
    throw new Error(`Environment variable ${name} is missing or shorter than ${minLength} characters.`);
  }
  return value;
}

export const config = {
  databaseUrl: required('DATABASE_URL'),
  stateSecret: required('STATE_SIGNING_SECRET', 32),
  providerSecret: required('MOCK_PROVIDER_SECRET', 32),
  port: Number(process.env.PORT ?? 4000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  demoMode: process.env.DEMO_MODE === 'true',
  isProduction: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  stateTtlMs: 10 * 60 * 1000,
  sessionTtlMs: 8 * 60 * 60 * 1000,
};
