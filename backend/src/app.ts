import express from 'express';
import { csrfProtection, errorHandler, requestContext } from './middleware/security.js';
import { router } from './routes/index.js';
import { notFound } from './lib/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext);
  app.use('/api', csrfProtection, express.json({ limit: '20kb' }), router);
  app.use(() => { throw notFound(); });
  app.use(errorHandler);
  return app;
}
