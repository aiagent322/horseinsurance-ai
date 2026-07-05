/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/_lib/responses.js
 *
 * SKELETON ONLY — see internal/specs/20-api-proxy-skeleton-plan.md
 *
 * Shared response-envelope helpers so every route returns a consistent shape.
 * This file contains NO business logic, NO Supabase access, and NO auth logic.
 * It is imported by route handlers to keep response shapes consistent
 * (Cloudflare Pages Functions use standard ES module import/export).
 *
 * Rules enforced by convention in every route that uses these helpers
 * (per specs 10, 11, 12, 20):
 *   - Never include policy text in any response or log line.
 *   - Never include another user's data.
 *   - Never include a public/durable file URL.
 *   - Never include internal error detail (stack traces, table/query names).
 */

/**
 * Standard success envelope.
 * @param {object} data - safe, already-scoped payload
 * @param {number} status - HTTP status code (default 200)
 */
export function jsonOk(data, status = 200) {
  return new Response(
    JSON.stringify({ ok: true, data: data ?? null }),
    {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }
  );
}

/**
 * Standard error envelope. Message must be consumer-safe (spec 20 §11) —
 * no stack traces, no internal identifiers, no policy text.
 * @param {string} code - machine-readable error code, e.g. "unauthenticated"
 * @param {string} message - plain-language, non-technical message
 * @param {number} status - HTTP status code
 */
export function jsonError(code, message, status = 400) {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message } }),
    {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    }
  );
}

/**
 * Standard placeholder for any route/path that has no real implementation yet.
 * Per task requirement: unavailable implementation paths return 501.
 */
export function notImplemented(routeName) {
  return jsonError(
    'not_implemented',
    `This endpoint (${routeName}) is a skeleton placeholder and is not implemented yet.`,
    501
  );
}

/**
 * Standard placeholder for unauthenticated access.
 * Real session validation is NOT implemented in this skeleton — see TODOs
 * in each route file. This helper exists so every route can fail the same
 * way once real auth is wired in (spec 12 §5/§6).
 */
export function unauthenticated() {
  return jsonError(
    'unauthenticated',
    'You must be signed in to do this.',
    401
  );
}

/**
 * Standard placeholder for an ownership/role mismatch.
 * Per spec 12 §6/§7 default-deny principle, and spec 20 §11: ownership
 * mismatches and "not found" should be indistinguishable to the caller.
 */
export function forbidden() {
  return jsonError(
    'forbidden',
    "You don't have access to this.",
    403
  );
}
