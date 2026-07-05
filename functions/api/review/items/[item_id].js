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

import { requireSession, requireReviewerRole, requireOwnership, validateRequestBody } from '../../_lib/guards.js';
import { safeError } from '../../_lib/responses.js';
import { auditSafeLog } from '../../_lib/audit.js';

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
  // Reusing requireOwnership() here as the item-level scope check per
  // internal/specs/23-api-route-guard-integration-plan.md §7; a real
  // implementation may need a dedicated scope check distinct from
  // resource ownership, but this placeholder keeps the same fail-closed
  // shape until that decision is made.
  const scopeCheck = requireOwnership(sessionCheck.session, itemId);
  if (!scopeCheck.ok) {
    return scopeCheck.response;
  }

  // TODO(validation): validate the real request body shape (the review
  // decision being submitted) once this route accepts real input
  // (internal/specs/22-api-guard-module-plan.md §11). Safe placeholder only.
  const bodyCheck = await validateRequestBody(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  // TODO(audit): once real review decisions exist, record them here —
  // object IDs, decision, and role only, never policy text (spec 22 §13).
  // Building the sanitized record now (not yet persisted) so the audit
  // shape is established alongside the guard integration.
  auditSafeLog({
    stage: 'review',
    objectId: itemId,
    decision: 'item_update_attempted',
    actorRole: 'reviewer',
  });

  // TODO(implementation): record the review decision and write an audit
  // event for it (spec 10 §13, spec 13 §12, spec 18 §16). No policy text
  // may ever be written to the audit trail (spec 17 §15.6).
  return safeError(
    'not_implemented',
    'This endpoint (PATCH /api/review/items/:item_id) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
