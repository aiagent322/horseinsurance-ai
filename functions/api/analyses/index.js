/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/analyses/index.js
 *
 * Route: POST /api/analyses
 * Purpose: Analysis creation — triggers the spec 10 pipeline for a
 * completed upload. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No pipeline is invoked. No Supabase connection.
 * No real extraction/classification/generation/verification logic here.
 */

import { requireSession, requireOwnership } from '../_lib/guards.js';
import { notImplemented } from '../_lib/responses.js';

export async function onRequestPost(context) {
  const { request } = context;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(ownership): confirm the validated session owns the underlying
  // upload referenced in the request body BEFORE triggering any pipeline
  // work (spec 12 §6/§7, spec 20 §6). The upload_id ownership check reuses
  // the same requireOwnership() pattern as functions/api/uploads/[upload_id]/files.js.
  //
  // TODO(ownership): When ownership checks are implemented, extract the real
  // upload_id from the validated request body and pass it into
  // requireOwnership(). Do not leave this as null in functional code.
  const ownershipCheck = requireOwnership(sessionCheck.session, /* uploadId */ null);
  if (!ownershipCheck.ok) {
    return ownershipCheck.response;
  }

  // TODO(implementation): trigger the spec 10 pipeline asynchronously and
  // return a processing-status handle — never block until the full
  // extract->classify->model->score/route->generate->verify->report
  // sequence completes (spec 10 §5, spec 20 §4/§8).
  return notImplemented('POST /api/analyses');
}
