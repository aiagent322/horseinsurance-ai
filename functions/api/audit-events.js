/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/audit-events.js
 *
 * Route: POST /api/audit-events
 * Purpose: Audit event creation — internal-only write path for pipeline/
 * reviewer audit records (spec 10 §13, spec 11 §8). (spec 20 §7, §8, §12)
 *
 * SKELETON ONLY. No Supabase connection. No real audit-write logic.
 *
 * This route is INTERNAL — it is meant to be called by the orchestration
 * layer itself (server-side, e.g. from other route handlers or a pipeline
 * worker), never directly by the frontend (spec 20 §12). Because no auth/
 * service-role wiring exists yet, this skeleton denies all access by
 * default rather than assuming a trusted internal caller.
 */

import { requireSession } from './_lib/guards.js';
import { notImplemented } from './_lib/responses.js';

export async function onRequestPost(context) {
  const { request } = context;

  // TODO(auth/internal-only): this route must only be reachable from the
  // orchestration layer itself, not the public frontend (spec 20 §12).
  // Real implementation needs an internal-call verification mechanism
  // (e.g. a service-to-service credential), NOT a normal user session.
  // Until that exists, this placeholder denies everything by default.
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(implementation): write object IDs, stage/decision labels, and
  // reasons only — NEVER policy text (spec 11 §8, spec 17 §15.6, spec 20
  // §12). This route must not log or persist any verbatim policy content
  // under any circumstance.
  return notImplemented('POST /api/audit-events');
}
