/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/_lib/audit.js
 *
 * SKELETON ONLY — see internal/specs/22-api-guard-module-plan.md (§13)
 * and internal/specs/11-backend-infrastructure-spec.md §8,
 * internal/specs/17-phase-1-migration-plan.md §15.6.
 *
 * auditSafeLog() is the single function any guard or route should use to
 * write a log/audit line, so "never log policy text or secrets" is enforced
 * structurally in one place rather than trusted to every call site.
 *
 * NOT IMPLEMENTED. No Supabase connection. No real persistence to an
 * audit_events table yet — this only builds and returns a sanitized record.
 * TODO(implementation): once Supabase is connected (spec 19, spec 21), wire
 * this to write via the internal POST /api/audit-events path (spec 20 §12)
 * using the service-role client (spec 21 §7/§12), never directly from the
 * frontend.
 */

/**
 * Fixed whitelist of fields this helper will ever accept. Anything outside
 * this list is silently dropped, not passed through — this is a structural
 * guarantee, not just a documented convention (spec 22 §13).
 */
const ALLOWED_FIELDS = [
  'stage',        // e.g. "extract", "classify", "generate", "verify", "review"
  'objectId',     // opaque ID only (analysis_id, upload_id, item_id, etc.)
  'decision',     // e.g. "blocked", "routed_to_review", "approved"
  'reason',       // short machine-readable reason code, NOT free text policy content
  'actorRole',    // e.g. "owner", "reviewer", "admin", "service"
  'timestamp',    // ISO 8601 UTC timestamp
];

/**
 * Builds a sanitized audit record from only the allowed fields above.
 * Fields not in ALLOWED_FIELDS are dropped, not logged, not persisted.
 *
 * This function does NOT:
 *   - accept or forward policy text / verbatim extracted document content
 *   - accept or forward secrets, tokens, or credentials
 *   - accept or forward file contents
 *   - accept or forward any file URL, public or private (spec 20 §10,
 *     spec 21 §5-§7 signed-URL rules)
 *
 * @param {object} event - candidate audit event; only whitelisted keys are kept
 * @returns {object} sanitized record (not yet persisted — TODO above)
 */
export function auditSafeLog(event = {}) {
  const safeRecord = {};
  for (const field of ALLOWED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(event, field)) {
      const value = event[field];
      // Extra guard: only allow primitive string/number/boolean values.
      // Objects/arrays are rejected outright rather than risk an unsafe
      // nested field (e.g. a snippet or URL) slipping through.
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        safeRecord[field] = value;
      }
    }
  }

  // TODO(implementation): persist safeRecord via the internal audit-events
  // write path once Supabase is connected. This skeleton does not call any
  // external service, does not write to a database, and does not log to
  // the console — it only returns the sanitized record so callers can see
  // what WOULD be recorded once implemented.
  return safeRecord;
}
