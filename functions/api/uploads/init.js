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

import { requireSession, requireAccountMembership, validateRequestBody } from '../_lib/guards.js';
import { safeError } from '../_lib/responses.js';

export async function onRequestPost(context) {
  const { request } = context;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response; // unauthenticated placeholder response
  }

  // TODO(account): confirm the validated session is actually a member of
  // the account it claims to act within, BEFORE creating any new resource
  // (spec 12 §4/§7, internal/specs/22-api-guard-module-plan.md §8). This
  // is distinct from ownership — there is no existing resource to own yet.
  const membershipCheck = requireAccountMembership(sessionCheck.session, /* accountId */ null);
  if (!membershipCheck.ok) {
    return membershipCheck.response;
  }

  // TODO(validation): validate the real request body shape once this route
  // accepts real input (internal/specs/22-api-guard-module-plan.md §11).
  // This is a safe placeholder check only — no schema enforcement yet.
  const bodyCheck = await validateRequestBody(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  // TODO(ownership): owner (user_id/account_id) must be set FROM the
  // validated session, never from the request body (spec 12 §8, spec 20 §8).

  // TODO(implementation): create upload_id/analysis_id in the database once
  // Phase 1 schema is applied and Supabase is connected (spec 19).
  // This route does not accept or process real policy files yet.
  return safeError(
    'not_implemented',
    'This endpoint (POST /api/uploads/init) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
