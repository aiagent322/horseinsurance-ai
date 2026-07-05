/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/session.js
 *
 * Route: GET /api/session
 * Purpose: Authenticated session check — confirms a valid session and
 * returns the caller's identity/role. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No auth provider connected. No real session validation.
 */

import { requireSession } from './_lib/guards.js';
import { safeError } from './_lib/responses.js';

export async function onRequestGet(context) {
  const { request } = context;

  // TODO(auth): validate the real session token here (spec 12 §5).
  const { ok, response } = requireSession(request);
  if (!ok) {
    return response; // unauthenticated placeholder response
  }

  // Unreachable until requireSession is implemented for real — kept here so
  // the route's eventual "authenticated" branch is visible in the skeleton.
  return safeError(
    'not_implemented',
    'This endpoint (GET /api/session, authenticated branch) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
