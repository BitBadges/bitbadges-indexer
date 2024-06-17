import { convertToCosmosAddress } from 'bitbadgesjs-sdk';
import { createChallenge, type ChallengeParams } from 'blockin';
import { statement, type BlockinSession, type MaybeAuthenticatedRequest } from '../blockin/blockin_handlers';

export const createExampleReqForAddress = (address: string) => {
  const challengeParams: ChallengeParams<bigint> = {
    domain: 'https://bitbadges.io',
    statement,
    address,
    uri: 'https://bitbadges.io',
    nonce: 'exampleNonce',
    expirationDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(),
    notBefore: undefined,
    resources: ['Full Access: Full access to all features.'],
    assetOwnershipRequirements: undefined
  };

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    session: {
      blockin: createChallenge(challengeParams),
      blockinParams: challengeParams,
      cosmosAddress: convertToCosmosAddress(address),
      address,
      nonce: 'exampleNonce',
      discord: {
        username: 'testuser',
        id: '123456789',
        access_token: '',
        discriminator: ''
      },
      twitter: {
        username: 'testuser',
        id: '123456789',
        access_token: '',
        access_token_secret: ''
      },
      github: {
        username: 'testuser',
        id: '123456789'
      },
      google: {
        username: 'testuser',
        id: '123456789'
      },
      twitch: {
        username: 'testuser',
        id: '123456789'
      }
    } as BlockinSession<bigint>
  } as MaybeAuthenticatedRequest<bigint>;
};
