import fs from 'fs';
import path from 'path';
import { getDb } from './client.js';
import { logger } from '../config/logger.js';

async function migrate() {
  const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf-8');

  const db = getDb();
  const { error } = await db.rpc('exec_sql', { sql });

  if (error) {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  }

  logger.info('Migration completed successfully');
}

migrate();
