/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/uploads/init.js
 *
 * Route: POST /api/uploads/init
 * Purpose: Upload initialization — creates an upload_id/analysis_id for a
 * new document set. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No real upload_id is created.
 * No policy files are accepted or processed by this route yet (task rule 10).
 */

import { requireSession } from '../_lib/guards.js';
import { notImplemented } from '../_lib/responses.js';

export async function onRequestPost(context) {
  const { request } = context;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const { ok, response } = requireSession(request);
  if (!ok) {
    return response; // unauthenticated placeholder response
  }

  // TODO(ownership): owner (user_id/account_id) must be set FROM the
  // validated session, never from the request body (spec 12 §8, spec 20 §8).

  // TODO(implementation): create upload_id/analysis_id in the database once
  // Phase 1 schema is applied and Supabase is connected (spec 19).
  // This route does not accept or process real policy files yet.
  return notImplemented('POST /api/uploads/init');
}
