import { InfuraProvider } from 'ethers';

export const provider = new InfuraProvider('homestead', process.env.INFURA_API_KEY);
