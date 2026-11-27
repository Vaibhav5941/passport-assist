// Runs API and web together on Windows, macOS and Linux.
import { spawn } from 'node:child_process';

const children = ['dev:api', 'dev:web'].map((name) =>
  spawn(`npm run ${name}`, { stdio: 'inherit', shell: true }),
);
const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { if (code) { stop(); process.exitCode = code; } }));
