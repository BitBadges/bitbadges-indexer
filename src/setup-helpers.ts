import { config } from "dotenv";
import Nano from "nano";
import { ANNOUNCEMENTS_DB, BALANCES_DB, COLLECTIONS_DB, REVIEWS_DB, STATUS_DB, TRANSFER_ACTIVITY_DB, insertToDB } from "./db/db";

config()

const nano = Nano(`${process.env.DB_URL}`);

export async function deleteDatabases() {
  await nano.db.destroy('transfer-activity').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('profiles').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('fetches').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('accounts').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('collections').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('status').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('errors').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('metadata').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('passwords').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('airdrop').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('balances').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('merkle-challenges').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('queue').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('ipfs-totals').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('refreshes').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('announcements').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('reviews').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('load-balance').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('address-mappings').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('approvals-trackers').catch((e) => { if (e.statusCode !== 404) throw e });

  //_utils, _replicator, _global_changes, _metadata
  await nano.db.destroy('_users').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('_replicator').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('_global_changes').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('_metadata').catch((e) => { if (e.statusCode !== 404) throw e });
}


export async function createDatabases() {
  await nano.db.create('transfer-activity', { partitioned: true });
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
  await nano.db.create('merkle-challenges', { partitioned: true });
  await nano.db.create('queue');
  await nano.db.create('ipfs-totals');
  await nano.db.create('refreshes');
  await nano.db.create('announcements', { partitioned: true });
  await nano.db.create('reviews', { partitioned: true });
  await nano.db.create('load-balance');
  await nano.db.create('address-mappings');
  await nano.db.create('approvals-trackers', { partitioned: true });


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
    "gasPrice": 1,
    "lastXGasAmounts": [
      "1"
    ],
    "lastXGasLimits": [
      "1"
    ],
  })
}

export async function createIndexesAndViews() {
  await TRANSFER_ACTIVITY_DB.createIndex({
    index: {
      fields: [{ 'timestamp': 'desc' }]
    },
    partitioned: true
  })
  await TRANSFER_ACTIVITY_DB.createIndex({
    index: {
      fields: [{ 'timestamp': 'desc' }]
    },
    partitioned: false
  })

  await ANNOUNCEMENTS_DB.createIndex({
    index: {
      fields: [{
        timestamp: 'desc'
      }]
    },
    partitioned: true
  })
  await ANNOUNCEMENTS_DB.createIndex({
    index: {
      fields: [{ 'timestamp': 'desc' }]
    },
    partitioned: false
  })

  await REVIEWS_DB.createIndex({
    index: {
      fields: [{ 'timestamp': 'desc' }]
    },
    partitioned: true
  })
  await REVIEWS_DB.createIndex({
    index: {
      fields: [{ 'timestamp': 'desc' }]
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

