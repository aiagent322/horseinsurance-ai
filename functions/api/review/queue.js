/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/review/queue.js
 *
 * Route: GET /api/review/queue
 * Purpose: Review queue listing — reviewer/admin-only list of routed
 * items (spec 13 §12). (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No real review-queue data.
 * Requires reviewer/admin role — never satisfied by a plain owner session.
 */

import { requireSession, requireReviewerRole } from '../_lib/guards.js';
import { safeError } from '../_lib/responses.js';
import { auditSafeLog } from '../_lib/audit.js';

export async function onRequestGet(context) {
  const { request } = context;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(role): confirm the validated session carries the reviewer/admin
  // role before returning ANY review-queue content (spec 12 §4/§13,
  // spec 20 §6). A plain "owner" session must never pass this check.
  const roleCheck = requireReviewerRole(sessionCheck.session);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  // TODO(audit): once real reviewer access exists, record it here — object
  // IDs, decision, and role only, never policy text (spec 22 §13). Building
  // the sanitized record now (not yet persisted) so the audit shape is
  // established alongside the guard integration.
  auditSafeLog({
    stage: 'review',
    decision: 'queue_listed',
    actorRole: 'reviewer',
  });

  // TODO(implementation): return only items routed/assigned to review
  // (spec 13 §12) — never a general content listing. This route never
  // exposes another user's policy text or unrelated analyses.
  return safeError(
    'not_implemented',
    'This endpoint (GET /api/review/queue) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
