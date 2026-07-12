import * as functions from 'firebase-functions';
import type { AuthLike } from '../core/types.js';

function asAuth(auth: AuthLike): { uid: string; token?: Record<string, unknown> } {
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  }
  return auth;
}

/** Require a signed-in user. */
export function requireAuth(auth: AuthLike): { uid: string; token?: Record<string, unknown> } {
  return asAuth(auth);
}

/** Require the signed-in uid to match a resource owner uid. */
export function requireOwner(auth: AuthLike, resourceUid: string): void {
  const user = asAuth(auth);
  if (user.uid !== resourceUid) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You do not own this resource.',
    );
  }
}

/**
 * Require a custom claim.
 * - If `expected` is omitted, the claim must be truthy (or a non-empty array).
 * - If `expected` is a string, boolean claims must equal it, or array claims must include it.
 * - If `expected` is boolean, the claim must strictly equal that boolean.
 */
export function requireClaim(
  auth: AuthLike,
  claimKey: string,
  expected?: string | boolean,
): void {
  const user = asAuth(auth);
  const value = user.token?.[claimKey];

  if (expected === undefined) {
    const ok =
      value === true
      || (typeof value === 'string' && value.length > 0)
      || (Array.isArray(value) && value.length > 0);
    if (!ok) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Missing required claim "${claimKey}".`,
      );
    }
    return;
  }

  if (typeof expected === 'boolean') {
    if (value !== expected) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `Missing required claim "${claimKey}".`,
      );
    }
    return;
  }

  if (value === expected) {
    return;
  }

  if (Array.isArray(value) && value.includes(expected)) {
    return;
  }

  throw new functions.https.HttpsError(
    'permission-denied',
    `Missing required claim "${claimKey}".`,
  );
}
