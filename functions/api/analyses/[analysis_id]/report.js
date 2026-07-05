/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/analyses/[analysis_id]/report.js
 *
 * Route: GET /api/analyses/:analysis_id/report
 * Purpose: Report retrieval — returns the assembled, verified report
 * (spec 05) for the caller's own analysis. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No real report assembly.
 * Must never return a statement that hasn't passed spec 09 verification,
 * and must never return a public/durable file URL (spec 10 §5, spec 20 §10).
 */

import { requireSession, requireOwnership } from '../../_lib/guards.js';
import { safeError } from '../../_lib/responses.js';

export async function onRequestGet(context) {
  const { request, params } = context;
  const analysisId = params.analysis_id;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(ownership): confirm the validated session owns :analysis_id BEFORE
  // returning any report content (spec 12 §6/§7, spec 20 §6).
  const ownershipCheck = requireOwnership(sessionCheck.session, analysisId);
  if (!ownershipCheck.ok) {
    return ownershipCheck.response;
  }

  // TODO(implementation): assemble and return only statements that passed
  // spec 09 verification (Fully Supported, or the re-verified remainder of
  // a rescoped statement) — never a blocked or unverified statement
  // (spec 10 §5, spec 05 report structure). Never include a public file URL.
  return safeError(
    'not_implemented',
    'This endpoint (GET /api/analyses/:analysis_id/report) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
