// import AlgoDriver from 'blockin-algo-driver';
import CosmosDriver from './CosmosDriver';
import EthDriver from './EthDriver'; //TODO: get from npm modules

const ethDriver = new EthDriver('eth');
const cosmosDriver = new CosmosDriver('bitbadges_1-1');

export const getChainDriver = (chain: string) => {
  // {
  //     serverUrl: process.env.MORALIS_SERVER_URL ? process.env.MORALIS_SERVER_URL : '',
  //     appId: process.env.MORALIS_APP_ID ? process.env.MORALIS_APP_ID : '',
  //     masterKey: process.env.MORALIS_APP_MASTER_KEY ? process.env.MORALIS_APP_MASTER_KEY : ''
  // });

  // const polygonDriver = new EthDriver('polygon', {
  //     serverUrl: process.env.MORALIS_SERVER_URL ? process.env.MORALIS_SERVER_URL : '',
  //     appId: process.env.MORALIS_APP_ID ? process.env.MORALIS_APP_ID : '',
  //     masterKey: process.env.MORALIS_APP_MASTER_KEY ? process.env.MORALIS_APP_MASTER_KEY : ''
  // });

  // const bscDriver = new EthDriver('bsc', {
  //     serverUrl: process.env.MORALIS_SERVER_URL ? process.env.MORALIS_SERVER_URL : '',
  //     appId: process.env.MORALIS_APP_ID ? process.env.MORALIS_APP_ID : '',
  //     masterKey: process.env.MORALIS_APP_MASTER_KEY ? process.env.MORALIS_APP_MASTER_KEY : ''
  // });

  // const avalancheDriver = new EthDriver('avalanche', {
  //     serverUrl: process.env.MORALIS_SERVER_URL ? process.env.MORALIS_SERVER_URL : '',
  //     appId: process.env.MORALIS_APP_ID ? process.env.MORALIS_APP_ID : '',
  //     masterKey: process.env.MORALIS_APP_MASTER_KEY ? process.env.MORALIS_APP_MASTER_KEY : ''
  // });

  // const algoTestnetDriver = new AlgoDriver('Testnet', process.env.ALGO_API_KEY ? process.env.ALGO_API_KEY : '');
  // const algoMainnetDriver = new AlgoDriver('Mainnet', process.env.ALGO_API_KEY ? process.env.ALGO_API_KEY : '');

  switch (chain) {
    // case 'Algorand Testnet':
    //     return algoTestnetDriver;
    // case 'Algorand Mainnet':
    //     return algoMainnetDriver;
    case 'Cosmos':
      return cosmosDriver;
    case 'Ethereum':
      return ethDriver;
    // case 'Polygon':
    //     return polygonDriver;
    // case 'Avalanche':
    //     return avalancheDriver;
    // case 'BSC':
    //     return bscDriver;
    default:
      return ethDriver;
  }
}