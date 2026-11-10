import { getEnv } from '../config/env.js';
import { connectDB, disconnectDB } from '../db/client.js';
import { syncDatasetCatalog } from '../services/dataset.service.js';

async function run(): Promise<void> {
  const env = getEnv();
  await connectDB({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: 5 });
  console.log(`Syncing ${env.DATASET_OWNER}/${env.DATASET_REPO}@${env.DATASET_BRANCH} ...`);
  const result = await syncDatasetCatalog(env, console);
  console.log(JSON.stringify(result, null, 2));
  await disconnectDB();
}

run().catch((err) => {
  console.error('Dataset sync failed:', err);
  process.exitCode = 1;
});
