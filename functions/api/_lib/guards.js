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

import { unauthenticated, forbidden } from './responses.js';

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
