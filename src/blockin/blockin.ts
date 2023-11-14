import EthDriver from './EthDriver';
import CosmosDriver from 'blockin-cosmos-driver';

const ethDriver = new EthDriver('0x1', undefined);
const cosmosDriver = new CosmosDriver('bitbadges_1-1');

export const getChainDriver = (chain: string) => {
  switch (chain) {
    case 'Cosmos':
      return cosmosDriver;
    case 'Ethereum':
      return ethDriver;
    default:
      return ethDriver;
  }
}