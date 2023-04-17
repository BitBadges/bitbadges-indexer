import { createDatabases, initStatus, createIndexes, deleteDatabases } from "./setup-helpers"

async function main() {
    await deleteDatabases();
    await createDatabases();
    await initStatus();
    await createIndexes();
}

main()