import { getDb } from '../src/db/client.js';
import { logger } from '../src/config/logger.js';

async function seedDb() {
  const db = getDb();

  const sampleLawyers = [
    {
      full_name: 'राम कुमार शर्मा',
      bar_council_id: 'BC-UP-2020-001',
      languages: ['hi', 'en'],
      districts: ['Lucknow', 'Varanasi'],
      specialization: ['cooperative', 'civil'],
      verified: true,
    },
    {
      full_name: 'सीता देवी पटेल',
      bar_council_id: 'BC-MP-2019-045',
      languages: ['hi'],
      districts: ['Bhopal', 'Indore'],
      specialization: ['cooperative', 'family'],
      verified: true,
    },
  ];

  for (const lawyer of sampleLawyers) {
    const { error } = await db.from('lawyer_directory').upsert(lawyer, { onConflict: 'bar_council_id' });
    if (error) {
      logger.error({ error, lawyer }, 'Failed to seed lawyer');
    }
  }

  logger.info('Database seeded successfully');
  process.exit(0);
}

seedDb();
