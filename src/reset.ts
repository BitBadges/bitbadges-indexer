import { config } from "dotenv"
import Nano from "nano";
import { ACTIVITY_DB, STATUS_DB } from "./db/db";
import { DbStatus } from "bitbadges-sdk";

config()

const nano = Nano(`${process.env.DB_URL}`);

export async function deleteDatabases() {
    try {
        await nano.db.destroy('activity');
        await nano.db.destroy('accounts');
        await nano.db.destroy('collections');
        await nano.db.destroy('status');
        await nano.db.destroy('errors');
        await nano.db.destroy('metadata');
        await nano.db.destroy('passwords');
        await nano.db.destroy('airdrop');
    } catch (error) {
        console.log(error)
    }
}


export async function createDatabases() {
    try {
        await nano.db.create('activity', { partitioned: true });
        await nano.db.create('accounts');
        await nano.db.create('collections');
        await nano.db.create('status');
        await nano.db.create('errors');
        await nano.db.create('metadata', { partitioned: true });
        await nano.db.create('passwords');
        await nano.db.create('airdrop');
    } catch (error) {
        console.log(error)
    }
}

export async function initStatus() {
    try {
        await STATUS_DB.insert({
            "_id": "status",
            "block": {
                "height": 0
            },
            "nextCollectionId": 1,
            "queue": [],
            "gasPrice": 0.000001,
            "lastXGasPrices": [
                0.000001
            ]
        } as DbStatus)
    } catch (error) {
        console.log(error)
    }
}

export async function createIndexes() {
    try {
        await ACTIVITY_DB.createIndex({
            index: {
                fields: ['timestamp']
            },
            partitioned: true
        })
        await ACTIVITY_DB.createIndex({
            index: {
                fields: ['timestamp']
            },
            partitioned: false
        })
    } catch (error) {
        console.log(error)
    }
}

async function main() {
    await deleteDatabases()
    await createDatabases()
    await initStatus()
    await createIndexes()
}

main()