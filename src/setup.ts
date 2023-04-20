import { createDatabases, initStatus, createIndexes } from "./setup-helpers"

async function main() {
    try {
        // await deleteDatabases();
        await createDatabases(); //If there is an error, we assume the database already exists and continue
        await initStatus();
        await createIndexes();
    } catch (e) {
        console.log(e);
    }
}

main()