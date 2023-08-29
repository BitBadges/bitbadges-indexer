import { config } from "dotenv";
import Nano from "nano";
import { ADDRESS_MAPPINGS_DB, ANNOUNCEMENTS_DB, BALANCES_DB, CLAIM_ALERTS_DB, COLLECTIONS_DB, REVIEWS_DB, STATUS_DB, TRANSFER_ACTIVITY_DB, insertToDB } from "./db/db";

config()

const nano = Nano(`${process.env.DB_URL}`);

export async function deleteDatabases() {
  //Deterministic
  await nano.db.destroy('accounts').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('collections').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('transfer-activity').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('approvals-trackers').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('merkle-challenges').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('msgs').catch((e) => { if (e.statusCode !== 404) throw e });

  //Can be, but may have off-chain features

  //Off-chain IDs need to be consistent and non-overlapping?
  //Solution could be to just involve the cosmosAddress in the ID?: off_Chain_cosmosAddress:ID
  await nano.db.destroy('address-mappings').catch((e) => { if (e.statusCode !== 404) throw e });
  //Data conflicts with off-chain balances potentially but only happens in case where two separate load balanced node receives and calls handleBalances before they sync
  //Current measures in place: 1 hour refresh time (although refreshes can be out of sync), would require two update txs on the blockchain, and would have to load balance to two separate nodes 
  //Could just resolve conflicts to latest updated at? And they can just refresh again the next hour?
  //Or, solution would just be to separate fetch + handleBalances logic into a no-conflict manner where handleBalances is always called by same node
  await nano.db.destroy('balances').catch((e) => { if (e.statusCode !== 404) throw e });
  //Status is deterministic but would have different num writes (rev nums) if we do the fast catch up mode - could be resolved by writing once every block
  await nano.db.destroy('status').catch((e) => { if (e.statusCode !== 404) throw e });

  //Can be / are designed to work with scaling - load balanced queues with no-conflict writes
  await nano.db.destroy('queue').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('fetches').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('load-balance').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('refreshes').catch((e) => { if (e.statusCode !== 404) throw e });

  //Manual - Fine since we are the only ones writing to it. Eventually will populate. Also will be replaced by a badge long term.
  await nano.db.destroy('api-keys').catch((e) => { if (e.statusCode !== 404) throw e });

  //Local and not replicated
  await nano.db.destroy('errors').catch((e) => { if (e.statusCode !== 404) throw e });

  //Are probably fine but could have data races with lastSeenActivity
  await nano.db.destroy('announcements').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('reviews').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('claim-alerts').catch((e) => { if (e.statusCode !== 404) throw e });

  //Probably need to have a consistent state across all nodes

  //Would probably be fine since writes are limited by cosmos address. Unique usernames will be a problem though.
  await nano.db.destroy('profiles').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('eth-tx-count').catch((e) => { if (e.statusCode !== 404) throw e });

  //NEEDS TO BE CONSISTENT ACROSS ALL NODES
  await nano.db.destroy('passwords').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('airdrop').catch((e) => { if (e.statusCode !== 404) throw e });
  //Attack here isn't too bad. Could for example upload up to limit (100 MB) simultaneously on each node and confuse the total.
  await nano.db.destroy('ipfs-totals').catch((e) => { if (e.statusCode !== 404) throw e });

  //_utils, _replicator, _global_changes, _metadata
  await nano.db.destroy('_users').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('_replicator').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('_global_changes').catch((e) => { if (e.statusCode !== 404) throw e });
  await nano.db.destroy('_metadata').catch((e) => { if (e.statusCode !== 404) throw e });
}


export async function createDatabases() {
  await nano.db.create('api-keys');
  await nano.db.create('transfer-activity', { partitioned: true });
  await nano.db.create('accounts');
  await nano.db.create('profiles');
  await nano.db.create('fetches');
  await nano.db.create('collections');
  await nano.db.create('status');
  await nano.db.create('errors');
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
  await nano.db.create('claim-alerts', { partitioned: true });
  await nano.db.create('eth-tx-count');
  await nano.db.create('msgs');


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

  await ADDRESS_MAPPINGS_DB.createIndex({
    index: {
      fields: ['createdBlock']
    },
    partitioned: false
  })

  await CLAIM_ALERTS_DB.createIndex({
    index: {
      fields: ['createdTimestamp']
    },
    partitioned: true
  })

  await ADDRESS_MAPPINGS_DB.createIndex({
    index: {
      fields: ['lastUpdated']
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
  
            if (
              doc.cosmosAddress !== "Mint" &&
              doc.cosmosAddress !== "Total" &&
              Array.isArray(doc.balances) &&
              doc.balances.some(balance => balance.amount > 0)
            ) {
              emit(doc.cosmosAddress, null);
            }
          }
        }`
      }
    },
    "language": "javascript",
    "options": {
      "partitioned": false
    }
  };


  await BALANCES_DB.insert(view);

  const claimAlertsDesignDocName = '_design/claim_alerts_by_address';

  const claimAlertsView = {
    _id: claimAlertsDesignDocName,
    views: {
      byCosmosAddress: {
        map: `function (doc) {
          if (doc._id) {

            for (const address of doc.cosmosAddresses) {
              if (
                address !== "Mint" &&
                address !== "Total"
              ) {
                emit(address, null);
              }
            }
          }
        }`
      }
    },
    "language": "javascript",
    "options": {
      "partitioned": false
    }
  };


  await CLAIM_ALERTS_DB.insert(claimAlertsView);

  const activityDesignDocName = '_design/transfer_activity_by_address';
  const activityView = {
    _id: activityDesignDocName,
    views: {
      byCosmosAddress: {
        map: `function (doc) {
          if (doc._id) {
            
            if (
              doc.from !== "Mint" &&
              doc.from !== "Total" &&
              Array.isArray(doc.balances) &&
              doc.balances.some(balance => balance.amount > 0)
            ) {
              emit(doc.from, null);
            }

            for (const address of doc.to) {
              if (
                address !== "Mint" &&
                address !== "Total" &&
                Array.isArray(doc.balances) &&
                doc.balances.some(balance => balance.amount > 0)
              ) {
                emit(address, null);
              }
            }
          }
        }`
      }
    },
    "language": "javascript",
    "options": {
      "partitioned": false
    }
  };


  await TRANSFER_ACTIVITY_DB.insert(activityView);
}

