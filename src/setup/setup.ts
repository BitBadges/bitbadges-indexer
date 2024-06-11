import { MongoDB } from '../db/db';
import { initStatus, createIndexesAndViews, deleteDatabases } from './setup-helpers';

async function main(): Promise<void> {
  try {
    // npm run setup with-delete
    if (process.argv[2] === 'with-delete') {
      await deleteDatabases();

      console.log('Deleted prior databases...');
    }

    await initStatus();

    console.log('Creating indexes and views...');

    await createIndexesAndViews();

    console.log('Indexes and views created successfully.');

    await MongoDB.close();

    console.log('Setup completed successfully.');

    // Run npm run bootstrap to init the bootstrapped collections
  } catch (e) {
    console.log(e);
  }
}

main().catch(console.error);
