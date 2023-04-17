import { deleteDatabases, createDatabases, initStatus, createIndexes } from "./setup-helpers"


async function main() {
    await deleteDatabases()
    await createDatabases()
    await initStatus()
    await createIndexes()
}

main()