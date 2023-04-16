import { createDatabases, initStatus, createIndexes } from "./reset"

async function main() {
    await createDatabases()
    await initStatus()
    await createIndexes()
}

main()