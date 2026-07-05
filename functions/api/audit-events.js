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

import { requireSession, requireServiceContext, validateRequestBody } from './_lib/guards.js';
import { safeError } from './_lib/responses.js';
import { auditSafeLog } from './_lib/audit.js';

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

  // TODO(service): this route's real caller is the orchestration layer
  // itself, not an ordinary authenticated user — requireSession() above is
  // kept as a conservative placeholder, and requireServiceContext() is
  // added alongside it (augmenting, not replacing) since
  // internal/specs/23-api-route-guard-integration-plan.md §7/§13 leaves the
  // replace-vs-augment decision open for a future, separately-approved
  // step. Both checks currently fail closed, so this route remains fully
  // denied either way.
  const serviceCheck = requireServiceContext(request);
  if (!serviceCheck.ok) {
    return serviceCheck.response;
  }

  // TODO(validation): validate the real audit-event body shape once this
  // route accepts real input (internal/specs/22-api-guard-module-plan.md
  // §11). Safe placeholder only — no schema enforcement yet.
  const bodyCheck = await validateRequestBody(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  // TODO(implementation): write object IDs, stage/decision labels, and
  // reasons only — NEVER policy text (spec 11 §8, spec 17 §15.6, spec 20
  // §12). This route must not log or persist any verbatim policy content
  // under any circumstance. auditSafeLog() below builds the sanitized
  // record shape this route would eventually persist — it is not yet
  // written anywhere (audit.js §13 TODO).
  auditSafeLog({
    stage: 'audit',
    decision: 'audit_event_write_attempted',
    actorRole: 'service',
  });

  return safeError(
    'not_implemented',
    'This endpoint (POST /api/audit-events) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
