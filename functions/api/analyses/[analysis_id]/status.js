/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/analyses/[analysis_id]/status.js
 *
 * Route: GET /api/analyses/:analysis_id/status
 * Purpose: Analysis status — reports current pipeline stage/progress for
 * the caller's own analysis. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. Returns only a fixed placeholder
 * status value, never raw extracted text or another user's data (spec 20 §10).
 */

import { requireSession, requireOwnership } from '../../_lib/guards.js';
import { notImplemented } from '../../_lib/responses.js';

export async function onRequestGet(context) {
  const { request, params } = context;
  const analysisId = params.analysis_id;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(ownership): confirm the validated session owns :analysis_id BEFORE
  // returning any status information (spec 12 §6/§7, spec 20 §6).
  const ownershipCheck = requireOwnership(sessionCheck.session, analysisId);
  if (!ownershipCheck.ok) {
    return ownershipCheck.response;
  }

  // TODO(implementation): return a small, fixed set of stage/progress values
  // (spec 20 §10) once the pipeline and database exist. No raw extracted
  // text, no policy text, no other user's data in this response ever.
  return notImplemented('GET /api/analyses/:analysis_id/status');
}
