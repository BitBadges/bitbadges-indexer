import { AlchemyProvider } from 'ethers';

export const provider = new AlchemyProvider('homestead', process.env.ALCHEMY_API_KEY);
