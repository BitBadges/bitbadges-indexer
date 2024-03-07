# BitBadges Indexer and API for the BitBadges Blockchain

Storing all possible data that may be needed for a project directly on the blockchain, such as all activity or metadata, would get expensive very quickly. Enter the BitBadges indexer!

See the [BitBadges Docs](https://docs.bitbadges.io/overview) for more information.

## How It Works

Every new block, the indexer will query the latest transactions added to the blockchain. The indexer will then iterate through all new transactions and index the data in a customizable manner. This makes certain data easily accessible and queryable, even though it isn't stored like that on the blockchain.

This indexer uses a refresh queue system for fetching off-chain details from their sources. This allows the indexer to fetch data in a controlled manner, so that the indexer does not overload the network.

## Running Your Own Indexer vs Using the BitBadges API

The indexer code is open-source in this repository, so feel free to run your own indexer and customize it as needed for your project.

However, we run an official BitBadges Indexer and API which should provide access to the necessary data required for most projects. See the [BitBadges Docs](https://docs.bitbadges.io/overview).

## Running the Indexer

### Running from Scratch

Steps:

- Install MongoDB
- Setup a valid .env file. See environment.d.ts for the expected format of the .env file.
- - Start a BitBadges blockchain node (or enter the address of an existing node in the .env file)
- Use

```bash
npm run setup
```

to setup the MongoDB databases. Only use this command on initial setup or when you want to reset entirely.

- Use

```bash
npm run dev
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

To restart from scratch, use

```bash
npm run setup with-delete
```

. This will wipe all data from the MongoDB databases and start the indexer from an empty state.

### Running from Docker

See [here](https://github.com/bitbadges/bitbadges-docker) for more information.

## Bootstrapping

If running a local development environment, you may want to bootstrap the indexer with some initial data. This can be done by running the `bootstrap` script. Initialize your blockchain with an account loaded with $BADGE funds, fill in the corresponding details in the .env file (FAUCET_MNEMONIC, FAUCET_ADDRESS), and run the following command:

```bash
npm run bootstrap
```

You can customize the transactions that are sent in the `bootstrap.ts` file.

## Acknowledgements

This indexer was forked from the [Cosmos Academy](https://github.com/cosmos/academy-checkers-ui). We want to thank the Cosmos Academy team for their work on this project.
