/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/review/items/[item_id].js
 *
 * Route: PATCH /api/review/items/:item_id
 * Purpose: Review item update — reviewer/admin-only decision on a routed
 * item (spec 13). (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No real review-decision logic.
 * Requires reviewer/admin role AND assignment/scope over the specific item.
 */

import { requireSession, requireReviewerRole } from '../../_lib/guards.js';
import { notImplemented } from '../../_lib/responses.js';

export async function onRequestPatch(context) {
  const { request, params } = context;
  const itemId = params.item_id;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(role): confirm the validated session carries the reviewer/admin
  // role (spec 12 §4/§13, spec 20 §6).
  const roleCheck = requireReviewerRole(sessionCheck.session);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  // TODO(ownership/scope): beyond the role check above, confirm this
  // specific reviewer/admin session is actually assigned/scoped to
  // :item_id before allowing any update (spec 13 §12, spec 18 §16) —
  // a reviewer role alone does not grant access to every queued item.

  // TODO(implementation): record the review decision and write an audit
  // event for it (spec 10 §13, spec 13 §12, spec 18 §16). No policy text
  // may ever be written to the audit trail (spec 17 §15.6).
  return notImplemented('PATCH /api/review/items/:item_id');
}
