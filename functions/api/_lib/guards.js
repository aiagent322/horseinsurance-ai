/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/_lib/guards.js
 *
 * SKELETON ONLY — see internal/specs/20-api-proxy-skeleton-plan.md (§5, §6)
 * and internal/specs/12-auth-account-isolation-spec.md.
 *
 * These are PLACEHOLDER guard functions. None of them perform real session
 * validation, ownership checks, or role checks. They exist so every route
 * file can call a consistently-named guard and so the TODOs for real auth/
 * ownership/role enforcement live in one obvious place before route logic
 * is written for real.
 *
 * NOT IMPLEMENTED. No Supabase connection. No auth provider connection.
 * No real session token is parsed or validated here.
 */

import { unauthenticated, forbidden, jsonError } from './responses.js';

/**
 * TODO(auth): Replace with real session validation per spec 12 §5.
 *   - Resolve the session token from the request (cookie/header).
 *   - Validate it against the auth provider (provider TBD — spec 15 §3).
 *   - Return { user_id, account_id, user_role } on success.
 *   - Treat an expired/invalid/missing session as unauthenticated — never
 *     default to a guest/demo identity (spec 12 §5).
 *
 * This placeholder ALWAYS reports "no session" since no auth provider is
 * connected yet (spec 19 §2). Every route using this guard will currently
 * behave as unauthenticated by design, which is the safe default.
 *
 * @param {Request} request
 * @returns {{ ok: boolean, session: null, response: Response|null }}
 */
export function requireSession(request) {
  // TODO(auth): real validation goes here. Until then, no session is ever
  // considered valid — this is the safe default per spec 12 §17 ("fail closed").
  return {
    ok: false,
    session: null,
    response: unauthenticated(),
  };
}

/**
 * TODO(ownership): Replace with real user_id/account_id ownership check
 * per spec 12 §6/§7 and spec 20 §6.
 *   - Given a validated session and a resource identifier (e.g. upload_id,
 *     analysis_id), query the database FILTERED BY the session's user_id/
 *     account_id — never fetch first and check after.
 *   - Absence of a positive match is a denial, never a pass (default-deny).
 *
 * This placeholder ALWAYS denies since there is no database connection yet.
 *
 * @param {object} session - resolved session identity (currently never populated)
 * @param {string} resourceId - the resource being accessed
 * @returns {{ ok: boolean, response: Response|null }}
 */
export function requireOwnership(session, resourceId) {
  // TODO(ownership): real check goes here. Until then, ownership never
  // resolves — this is the safe default (spec 12 §6/§17 default-deny).
  return {
    ok: false,
    response: forbidden(),
  };
}

/**
 * TODO(role): Replace with real reviewer/admin role check per spec 12 §4/§13
 * and spec 20 §6/§8.
 *   - Given a validated session, confirm session.user_role is "reviewer" or
 *     "admin" before allowing access to review-queue routes.
 *   - A plain "owner" session must never satisfy this check.
 *   - Reviewer/admin access is itself scoped to routed/assigned items only —
 *     this guard only checks the role, not per-item scope (that is a
 *     separate TODO in the review routes themselves).
 *
 * This placeholder ALWAYS denies since there is no session/role resolution yet.
 *
 * @param {object} session - resolved session identity (currently never populated)
 * @returns {{ ok: boolean, response: Response|null }}
 */
export function requireReviewerRole(session) {
  // TODO(role): real check goes here. Until then, no session ever carries a
  // reviewer/admin role — this is the safe default (default-deny).
  return {
    ok: false,
    response: forbidden(),
  };
}

/**
 * TODO(account): Replace with real account-membership check per
 * internal/specs/22-api-guard-module-plan.md §8 and spec 12 §4/§7.
 *   - Given a resolved session (user_id) and an account_id it claims to act
 *     within, confirm the user is actually a member of that account by
 *     querying account_members (spec 16 §4) — server-side, never trusting a
 *     client-supplied account_id.
 *   - Distinct from requireOwnership(): this checks "is the user part of
 *     this account at all," not "does this account own resource X."
 *   - MVP is 1 user : 1 account (spec 12 §4), but this guard exists
 *     separately now so a future multi-user account doesn't require
 *     re-plumbing every route that needs this check.
 *
 * This placeholder ALWAYS denies since there is no database connection yet.
 *
 * @param {object} session - resolved session identity (currently never populated)
 * @param {string} accountId - the account being acted within
 * @returns {{ ok: boolean, response: Response|null }}
 */
export function requireAccountMembership(session, accountId) {
  // TODO(account): real check goes here. Until then, membership never
  // resolves — this is the safe default (spec 12 §7/§17 default-deny).
  return {
    ok: false,
    response: forbidden(),
  };
}

/**
 * TODO(role): Replace with real admin-only role check per
 * internal/specs/22-api-guard-module-plan.md §9 and spec 12 §4/§13.
 *   - Stricter than requireReviewerRole(): confirms session.user_role is
 *     specifically "admin", for any future operation that needs more than
 *     ordinary reviewer scope (e.g. reassigning/escalating a review item,
 *     spec 18 §16).
 *   - No route in the current skeleton requires this yet; it exists so a
 *     future admin-only route has a ready-made, consistently-named guard.
 *
 * This placeholder ALWAYS denies since there is no session/role resolution yet.
 *
 * @param {object} session - resolved session identity (currently never populated)
 * @returns {{ ok: boolean, response: Response|null }}
 */
export function requireAdminRole(session) {
  // TODO(role): real check goes here. Until then, no session ever carries the
  // admin role — this is the safe default (default-deny).
  return {
    ok: false,
    response: forbidden(),
  };
}

/**
 * TODO(service): Replace with real internal-call verification per
 * internal/specs/22-api-guard-module-plan.md §10 and spec 20 §12/§14.
 *   - Distinguishes a legitimate internal/system-initiated call (e.g. the
 *     orchestration layer calling POST /api/audit-events) from an ordinary
 *     external request — NOT a user-identity check.
 *   - Does NOT by itself grant service-role Supabase access; it only
 *     answers "is this call coming from where it's supposed to come from."
 *   - Real implementation needs a service-to-service credential mechanism,
 *     never a client-suppliable header or flag that could be spoofed by an
 *     ordinary request (spec 19 §12, spec 21 §7).
 *
 * This placeholder ALWAYS denies since no internal-call verification
 * mechanism exists yet — safe default until real service-to-service auth
 * is designed and approved.
 *
 * @param {Request} request
 * @returns {{ ok: boolean, response: Response|null }}
 */
export function requireServiceContext(request) {
  // TODO(service): real internal-call verification goes here. Until then,
  // no call is ever treated as a trusted internal/service caller — this is
  // the safe default (default-deny). The eventual service-role Supabase
  // client (spec 21 §7) must remain server-side only regardless.
  return {
    ok: false,
    response: forbidden(),
  };
}

/**
 * TODO(validation): Replace with real request-body shape/type validation
 * per internal/specs/22-api-guard-module-plan.md §11 and spec 20 §9.
 *   - Each route is expected to supply its own expected shape; this helper
 *     applies that shape consistently rather than each route hand-rolling
 *     validation inline.
 *   - Validation should run BEFORE any ownership/role check that depends on
 *     the body's contents (spec 20 §9).
 *   - This is a SAFE PLACEHOLDER only: it performs a minimal, non-throwing
 *     shape check (is the body parseable JSON, when present) and does NOT
 *     yet implement real per-route schema validation or business-rule
 *     validation (e.g. "is this a valid coverage category" — that remains
 *     pipeline-owned logic, specs 02-09, out of scope for this guard).
 *
 * @param {Request} request
 * @returns {{ ok: boolean, body: object|null, response: Response|null }}
 */
export async function validateRequestBody(request) {
  // Basic safe placeholder: attempt to parse JSON if a body is present.
  // No schema enforcement yet (TODO above) — this only guards against
  // outright malformed input reaching a route handler.
  const method = request.method?.toUpperCase?.() ?? '';
  if (method === 'GET' || method === 'HEAD') {
    return { ok: true, body: null, response: null };
  }

  try {
    const text = await request.clone().text();
    if (!text) {
      return { ok: true, body: null, response: null };
    }
    const parsed = JSON.parse(text);
    return { ok: true, body: parsed, response: null };
  } catch (err) {
    // Never surface parser internals (spec 20 §11 consumer-safe errors).
    return {
      ok: false,
      body: null,
      response: jsonError(
        'invalid_request_body',
        'We could not read that request. Please check the request and try again.',
        400
      ),
    };
  }
}
