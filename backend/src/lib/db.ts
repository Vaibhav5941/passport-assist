// Data access: pooling, transactions and snake_case -> camelCase mapping.
// All queries use bound parameters. Never interpolate user input into SQL.
import pg from 'pg';
import { config } from '../config.js';

pg.types.setTypeParser(1082, (value) => value); // keep DATE as YYYY-MM-DD

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = pg.Pool | pg.PoolClient;

const camel = (key: string) => key.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

export async function query<T>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, params);
  return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) as T);
}

export async function one<T>(db: Db, text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await query<T>(db, text, params))[0];
}

export async function transaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
