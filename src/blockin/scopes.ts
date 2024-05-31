import { OAuthScopeDetails, type NumberType } from 'bitbadgesjs-sdk';
import { type Response } from 'express';
import { getAuthDetails, type MaybeAuthenticatedRequest } from './blockin_handlers';

// We use a "Label : Explanation" format for the scopes
export const SupportedScopes = [
  'Full Access: Full access to all features.',
  'Report: Report users or collections.',
  'Reviews: Create, read, update, and delete reviews.',

  'Read Profile: Read your private profile information. This includes your email, approved sign-in methods, connections, and other private information.',

  // This probably should not be a scope because if this is granted, the user can change their scopes on their approved sign ins.
  // 'Update Profile: Update your user profile information. This includes your email, approved sign-in methods, connections, and other private information, as well as your public facing profile.',

  'Read Address Lists: Read private address lists on behalf of the user.',
  'Create Address Lists: Create new address lists on behalf of the user (private or public).',
  'Update Address Lists: Update address lists on behalf of the user.',
  'Delete Address Lists: Delete address lists on behalf of the user.',

  'Create Siwbb Requests: Create new authentication codes on behalf of the user.', //Still need signature for this
  'Read Siwbb Requests: Read authentication codes on behalf of the user.',
  'Delete Siwbb Requests: Delete authentication codes on behalf of the user.',

  'Send Claim Alerts: Send claim alerts on behalf of the user.',
  'Read Claim Alerts: Read claim alerts on behalf of the user. Note that claim alerts may contain sensitive information like claim codes, secret IDs, etc.',

  'Create Secrets: Create new secrets on behalf of the user.',
  'Read Secrets: Read secrets on behalf of the user.',
  'Delete Secrets: Delete secrets on behalf of the user.',
  'Update Secrets: Update secrets on behalf of the user.',

  'Read Private Claim Data: Read private claim data on behalf of the user (e.g. codes, passwords, private user lists, etc.).',
  'Complete Claims: Complete claims on behalf of the user.',

  'Manage Off-Chain Balances: Manage off-chain balances on behalf of the user.'
];

function checkScope(scope: string, resources: string[]): boolean {
  const expectedScope = SupportedScopes.find((s) => s.startsWith(scope));

  if (!expectedScope || !resources.includes(expectedScope)) {
    return false;
  }

  return true;
}

export async function hasScopes(
  req: MaybeAuthenticatedRequest<NumberType>,
  res: Response,
  expectedScopes: { scopeName: string; toCheck?: object }[]
): Promise<boolean> {
  const authDetails = await getAuthDetails(req, res);
  if (!authDetails) {
    return false;
  }

  const resources = (await getAuthDetails(req, res))?.blockinParams?.resources ?? [];
  if (checkScope('Full Access', resources)) {
    return true;
  }

  //We use the scopes from OAuth to determine what the user can do.
  const scopes = authDetails.scopes ?? [];
  for (const expectedScope of expectedScopes) {
    const matchingScope = scopes.find((s) => s.scopeName === expectedScope.scopeName);
    if (!matchingScope) {
      return false;
    }

    if (!checkScopeOptions(matchingScope, expectedScope.toCheck)) {
      return false;
    }
  }

  return true;
}

function checkScopeOptions(scope: OAuthScopeDetails, toCheck?: object) {
  if (!toCheck) return true;

  if (toCheck) {
    switch (scope.scopeName) {
      case 'Complete Claims':
        return checkCompleteClaimScope(scope.options, toCheck);
    }

    return false;
  } else {
    return true;
  }
}

//------------------HANDLERS------------------

//TODO: Handle
function checkCompleteClaimScope(scopeOptions: any | undefined, toCheck: any): boolean {
  console.log(scopeOptions, toCheck);

  // Example
  // return toCheck.claimIds.every((claimId) => scopeOptions?.claimIds?.includes(claimId));
  return true;
}
