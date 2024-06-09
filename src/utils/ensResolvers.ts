import { ethers } from 'ethers';

export const provider = new ethers.providers.AlchemyProvider('homestead', process.env.ALCHEMY_API_KEY);
