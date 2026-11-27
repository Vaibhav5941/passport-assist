import { config } from './config.js';
import { createApp } from './app.js';
import { log } from './lib/logger.js';

// Bound to loopback: this demo is meant to run locally only.
createApp().listen(config.port, '0.0.0.0', () => log('info', `API listening on port ${config.port}`));