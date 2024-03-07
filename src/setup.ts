import { MongoDB } from './db/db';
import { initStatus, createIndexesAndViews, deleteDatabases } from './setup-helpers';

async function main(): Promise<void> {
  try {
    // npm run setup with-delete
    if (process.argv[2] === 'with-delete') {
      await deleteDatabases();
    }

    await initStatus();
    await createIndexesAndViews();

    await MongoDB.close();

    // Run npm run bootstrap to init the bootstrapped collections
  } catch (e) {
    console.log(e);
  }
}

main().catch(console.error);
