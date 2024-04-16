import { type NumberType } from 'bitbadgesjs-sdk';
import { type MaybeAuthenticatedRequest } from './blockin_handlers';

// We use a "Label : Explanation" format for the scopes
const SupportedScopes = [
  'Full Access: Full access to all features.',
  'Report: Report users or collections.',
  'Reviews: Create, read, update, and delete reviews.',
  'Profile: Maintain your user profile information and view private information.',
  'Address Lists: Create, read, update, and delete address lists.',
  'Auth Codes: Manage authentication codes.',
  'Claim Alerts: Manage claim alerts.',
  'Secrets: Manage the account secrets and credentials.'
];

export function hasScopes(req: MaybeAuthenticatedRequest<NumberType>, expectedScopeLabels: string[]): boolean {
  const resources = req.session.blockinParams?.resources ?? [];

  console.log('resources', resources);

  const scopeLabels = resources.map((r) => r.split(':')?.[0]).map((r) => r.trim());
  if (scopeLabels.includes('Full Access')) {
    return true;
  }
  console.log('scopeLabels', scopeLabels);

  // We need to check that a) the message was signed with the expected scope and b) the scope message matches.
  for (const expectedScopeLabel of expectedScopeLabels) {
    const expectedScope = SupportedScopes.find((s) => s.startsWith(expectedScopeLabel));
    if (!expectedScope || !resources.includes(expectedScope)) {
      return false;
    }
  }

  return true;
}
