import pgPromise from 'pg-promise';
import { config } from './config.js';

export const pgp = pgPromise();
export const db = pgp(config.database);

export async function checkDatabase() {
  await db.one('SELECT 1 AS connected');
}
