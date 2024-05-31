import crypto from 'crypto';

export function getMockAxiosResponse(route: string) {
  switch (route) {
    case 'random-claim-number':
      return {
        data: {
          claimNumber: Math.ceil(Math.random() * 98) + 2
        },
        status: 200
      };
    case 'same-claim-number':
      return {
        data: {
          claimNumber: 5
        },
        status: 200
      };
    case 'random-state-transition':
      return {
        data: {
          newState: { random: Math.ceil(Math.random() * 1000) + 2 }
        },
        status: 200
      };
    case 'claim-tokens-same':
      return {
        data: {
          claimToken: 'same'
        },
        status: 200
      };
    case 'claim-tokens-different':
      return {
        data: {
          claimToken: crypto.randomBytes(32).toString('hex')
        },
        status: 200
      };
  }

  throw new Error('Route not found');
}
