import {
  createDatabases, initStatus, createIndexesAndViews,
  deleteDatabases
} from "./setup-helpers"

async function main() {
  try {
    if (process.argv[2] === 'with-delete') {
      await deleteDatabases();
    }

    await createDatabases(); //If there is an error, we assume the database already exists and continue
    await initStatus();
    await createIndexesAndViews();

    // await bootstrapCollections();
  } catch (e) {
    console.log(e);
  }
}

main()