/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/analyses/[analysis_id]/answers.js
 *
 * Route: POST /api/analyses/:analysis_id/answers
 * Purpose: Answer request — asks a direct consumer question against a
 * completed analysis (spec 04). (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No real generate/verify logic.
 * No question is processed by this route yet — this is a placeholder only.
 */

import { requireSession, requireOwnership, validateRequestBody } from '../../_lib/guards.js';
import { safeError } from '../../_lib/responses.js';

export async function onRequestPost(context) {
  const { request, params } = context;
  const analysisId = params.analysis_id;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(ownership): confirm the validated session owns :analysis_id BEFORE
  // running any question against it (spec 12 §6/§7, spec 20 §6).
  const ownershipCheck = requireOwnership(sessionCheck.session, analysisId);
  if (!ownershipCheck.ok) {
    return ownershipCheck.response;
  }

  // TODO(validation): validate the real request body shape (the question
  // being asked) once this route accepts real input
  // (internal/specs/22-api-guard-module-plan.md §11). Safe placeholder only.
  const bodyCheck = await validateRequestBody(request);
  if (!bodyCheck.ok) {
    return bodyCheck.response;
  }

  // TODO(implementation): run the question through generate->verify
  // (spec 10 §7) and return the resulting answer object (spec 04 §16) or a
  // refusal per spec 04 §15. No real generation/verification logic exists
  // in this skeleton — this route must not fabricate an answer.
  return safeError(
    'not_implemented',
    'This endpoint (POST /api/analyses/:analysis_id/answers) is a skeleton placeholder and is not implemented yet.',
    501
  );
}
