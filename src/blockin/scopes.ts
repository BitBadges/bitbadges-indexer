import { NumberType } from 'bitbadgesjs-sdk';
import { MaybeAuthenticatedRequest } from './blockin_handlers';

export function hasScopes(req: MaybeAuthenticatedRequest<NumberType>, expectedScopes: string[]) {
  const resources = req.session.blockinParams?.resources;
  if (!resources || !resources.length) {
    return false;
  }

  //We use a "Label : Explanation" format for the scopes
  const scopes = resources.map((r) => r.split(':')?.[0]).map((r) => r.trim());

  if (scopes.includes('Full Access')) {
    return true;
  }

  for (const expectedScope of expectedScopes) {
    if (!resources.includes(expectedScope)) {
      return false;
    }
  }

  return true;
}

export function mustHaveScopes(req: MaybeAuthenticatedRequest<NumberType>, expectedScopes: string[]) {
  if (!hasScopes(req, expectedScopes)) {
    throw new Error('Unauthorized');
  }
}
