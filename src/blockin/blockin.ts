import EthDriver from './EthDriver';
import CosmosDriver from './CosmosDriver';
import SolDriver from './SolDriver';
import BtcDriver from './BtcDriver';
import { type IChainDriver } from 'blockin';

const ethDriver = new EthDriver('0x1');
const solDriver = new SolDriver('');
const cosmosDriver = new CosmosDriver('bitbadges_1-1');
const btcDriver = new BtcDriver('Bitcoin');

export const getChainDriver = (chain: string): IChainDriver<bigint> => {
  switch (chain) {
    case 'Cosmos':
      return cosmosDriver;
    case 'Ethereum':
      return ethDriver;
    case 'Solana':
      return solDriver;
    case 'Bitcoin':
      return btcDriver;
    default:
      return ethDriver;
  }
};
