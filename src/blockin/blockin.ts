import EthDriver from './EthDriver';
import CosmosDriver from './CosmosDriver';
import SolDriver from './SolDriver';
import BtcDriver from './BtcDriver';

const ethDriver = new EthDriver('0x1', undefined);
const solDriver = new SolDriver('');
const cosmosDriver = new CosmosDriver('bitbadges_1-1');
const btcDriver = new BtcDriver('Bitcoin');

export const getChainDriver = (chain: string) => {
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
}