import EthDriver from './EthDriver';
import CosmosDriver from './CosmosDriver';
import SolDriver from './SolDriver';

const ethDriver = new EthDriver('0x1', undefined);
const solDriver = new SolDriver('');
const cosmosDriver = new CosmosDriver('bitbadges_1-1');

export const getChainDriver = (chain: string) => {
  switch (chain) {
    case 'Cosmos':
      return cosmosDriver;
    case 'Ethereum':
      return ethDriver;
    case 'Solana':
      return solDriver;
    default:
      return ethDriver;
  }
}