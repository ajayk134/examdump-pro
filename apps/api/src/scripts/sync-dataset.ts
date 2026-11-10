import { getEnv } from '../config/env.js';
import { connectDB, disconnectDB } from '../db/connect.js';
import { syncDatasetCatalog } from '../services/dataset.service.js';

async function run(): Promise<void> {
  const env = getEnv();
  await connectDB({ uri: env.MONGODB_URI, dbName: env.MONGODB_DB });
  console.log(`Syncing ${env.DATASET_OWNER}/${env.DATASET_REPO}@${env.DATASET_BRANCH} ...`);
  const result = await syncDatasetCatalog(env, console);
  console.log(JSON.stringify(result, null, 2));
  await disconnectDB();
}

run().catch((err) => {
  console.error('Dataset sync failed:', err);
  process.exitCode = 1;
});