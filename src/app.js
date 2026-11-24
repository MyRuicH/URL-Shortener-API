import { readFileSync } from 'node:fs';
import express from 'express';
import { load } from 'js-yaml';
import swaggerUi from 'swagger-ui-express';
import { checkDatabase } from './db.js';

const specification = load(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8'));
export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

app.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await checkDatabase();
    res.json({ status: 'ok', database: 'up' });
  } catch {
    res.status(503).json({ status: 'error', database: 'down' });
  }
});

app.use('/docs', swaggerUi.serve, swaggerUi.setup(specification));
