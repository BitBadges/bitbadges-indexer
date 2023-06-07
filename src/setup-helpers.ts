import { config } from "dotenv";
import Nano from "nano";
import { ANNOUNCEMENTS_DB, BALANCES_DB, COLLECTIONS_DB, REVIEWS_DB, STATUS_DB, TRANSFER_ACTIVITY_DB, insertToDB } from "./db/db";

config()

const nano = Nano(`${process.env.DB_URL}`);

export async function deleteDatabases() {
  await nano.db.destroy('activity');
  await nano.db.destroy('profiles');
  await nano.db.destroy('fetches');
  await nano.db.destroy('accounts');
  await nano.db.destroy('collections');
  await nano.db.destroy('status');
  await nano.db.destroy('errors');
  await nano.db.destroy('metadata');
  await nano.db.destroy('passwords');
  await nano.db.destroy('airdrop');
  await nano.db.destroy('balances');
  await nano.db.destroy('claims');
  await nano.db.destroy('queue');
  await nano.db.destroy('ipfs_totals');
  await nano.db.destroy('refreshes');
  await nano.db.destroy('announcements');
  await nano.db.destroy('reviews');
  await nano.db.destroy('load-balance');

  //_utils, _replicator, _global_changes, _metadata
  await nano.db.destroy('_users');
  await nano.db.destroy('_replicator');
  await nano.db.destroy('_global_changes');
  await nano.db.destroy('_metadata');
}


export async function createDatabases() {
  await nano.db.create('activity', { partitioned: true });
  await nano.db.create('accounts');
  await nano.db.create('profiles');
  await nano.db.create('fetches');
  await nano.db.create('collections');
  await nano.db.create('status');
  await nano.db.create('errors');
  await nano.db.create('metadata', { partitioned: true });
  await nano.db.create('passwords');
  await nano.db.create('airdrop');
  await nano.db.create('balances', { partitioned: true });
  await nano.db.create('claims', { partitioned: true });
  await nano.db.create('queue');
  await nano.db.create('ipfs_totals');
  await nano.db.create('refreshes');
  await nano.db.create('announcements', { partitioned: true });
  await nano.db.create('reviews', { partitioned: true });
  await nano.db.create('load-balance');

  //_utils, _replicator, _global_changes, _metadata
  await nano.db.create('_users');
  await nano.db.create('_replicator');
  await nano.db.create('_global_changes');
  await nano.db.create('_metadata');
}

export async function initStatus() {
  await insertToDB(STATUS_DB, {
    "_id": "status",
    "block": {
      "height": "1",
      "txIndex": "0",
      "timestamp": 0
    },
    "nextCollectionId": "1",
    "gasPrice": "0.000001",
    "lastXGasPrices": [
      "0.000001"
    ]
  })
}

export async function createIndexesAndViews() {
  await TRANSFER_ACTIVITY_DB.createIndex({
    index: {
      fields: ['timestamp']
    },
    partitioned: true
  })
  await TRANSFER_ACTIVITY_DB.createIndex({
    index: {
      fields: ['timestamp']
    },
    partitioned: false
  })

  await ANNOUNCEMENTS_DB.createIndex({
    index: {
      fields: ['timestamp']
    },
    partitioned: true
  })
  await ANNOUNCEMENTS_DB.createIndex({
    index: {
      fields: ['timestamp']
    },
    partitioned: false
  })

  await REVIEWS_DB.createIndex({
    index: {
      fields: ['timestamp']
    },
    partitioned: true
  })
  await REVIEWS_DB.createIndex({
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

  const designDocName = '_design/balances_by_address';

  const view = {
    _id: designDocName,
    views: {
      byCosmosAddress: {
        map: `function (doc) {
          if (doc._id) {
            emit(doc.cosmosAddress, null);
          }
        }`
      }
    }
  };


  await BALANCES_DB.insert(view);
}