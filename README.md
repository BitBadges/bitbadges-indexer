# BitBadges Indexer and API for the BitBadges Blockchain
Storing all possible data that may be needed for a project directly on the blockchain, such as all activity or metadata, would get expensive very quickly. Enter the BitBadges indexer!

See the [BitBadges Docs](
    https://docs.bitbadges.io
) for more information.

## How It Works
Every second, the indexer will query the latest transactions added to the blockchain. The indexer will then iterate through all new transactions and index the data in a customizable manner via CouchDB. 

This version of the indexer will index user activity, balances, and metadata (via a queue).

For example, if a new MsgTransferBadge transaction is observed, the indexer can add this to an activity array stored for that user in CouchDB. All activity for a specific user can then be easily fetched via the Express.js API. This makes certain data easily accessible and queryable, even though it isn't stored like that on the blockchain.

## Running Your Own Indexer vs Using the BitBadges API
The indexer code is open-source, so feel free to run your own indexer and customize it as needed for your project. 

However, we run an official BitBadges Indexer and API which should provide access to the necessary data required for most projects. See the [BitBadges Docs](
    https://docs.bitbadges.io
).

Note that CouchDB uses an optimistic conflict resolution system. If you add functionality to the indexer, design it with this in mind.

## Running the Indexer
### Running from Scratch
Steps:
- Install CouchDB
- Start a BitBadges blockchain node
- Setup a valid .env file. See environment.d.ts for the expected format of the .env file.
- Use 
```bash
npm run setup
``` 
to setup the CouchDB databases. Note that this wipes everything to initial state, so do not use this command if you already have progress saved. Only use this command on initial setup or when you want to reset entirely.
- Use 
```bash
npm run indexer-dev
```
to start in development mode.
- Use 
```bash
npm run build
```
and 
```bash
npm run indexer
``` 
to start in production mode.

### Running from Docker
See [here](https://github.com/bitbadges/bitbadges-docker) for more information.

## Acknowledgements
This indexer was forked from the [Cosmos Academy](
    https://github.com/cosmos/academy-checkers-ui
). We want to thank the Cosmos Academy team for their work on this project.