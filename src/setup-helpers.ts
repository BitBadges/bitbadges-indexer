import { config } from "dotenv"
import Nano from "nano";
import { ACTIVITY_DB, STATUS_DB, COLLECTIONS_DB } from "./db/db";
import { DbStatus } from "bitbadgesjs-utils";

config()

const nano = Nano(`${process.env.DB_URL}`);

export async function deleteDatabases() {
  await nano.db.destroy('activity');
  await nano.db.destroy('accounts');
  await nano.db.destroy('collections');
  await nano.db.destroy('status');
  await nano.db.destroy('errors');
  await nano.db.destroy('metadata');
  await nano.db.destroy('passwords');
  await nano.db.destroy('airdrop');
  await nano.db.destroy('balances');
  await nano.db.destroy('claims');

  //_utils, _replicator, _global_changes, _metadata
  await nano.db.destroy('_users');
  await nano.db.destroy('_replicator');
  await nano.db.destroy('_global_changes');
  await nano.db.destroy('_metadata');
}


export async function createDatabases() {
  await nano.db.create('activity', { partitioned: true });
  await nano.db.create('accounts');
  await nano.db.create('collections');
  await nano.db.create('status');
  await nano.db.create('errors');
  await nano.db.create('metadata', { partitioned: true });
  await nano.db.create('passwords');
  await nano.db.create('airdrop');
  await nano.db.create('balances', { partitioned: true });
  await nano.db.create('claims', { partitioned: true });

  //_utils, _replicator, _global_changes, _metadata
  await nano.db.create('_users');
  await nano.db.create('_replicator');
  await nano.db.create('_global_changes');
  await nano.db.create('_metadata');
}

export async function initStatus() {
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
}

export async function createIndexes() {
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

  await COLLECTIONS_DB.createIndex({
    index: {
      fields: ['createdBlock']
    },
    partitioned: false
  })
}