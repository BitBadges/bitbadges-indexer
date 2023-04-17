import { createDatabases, initStatus, createIndexes } from "./setup-helpers"

async function main() {
    await createDatabases()
    await initStatus()
    await createIndexes()
}

main()