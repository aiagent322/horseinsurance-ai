/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/uploads/[upload_id]/files.js
 *
 * Route: POST /api/uploads/:upload_id/files
 * Purpose: Private upload file registration — records a file's private
 * storage reference against the upload. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No object storage connection.
 * This route MUST NEVER return a public/durable file URL (spec 20 §8, §10).
 * No real policy files are accepted or processed yet (task rule 10).
 */

import { requireSession, requireOwnership } from '../../_lib/guards.js';
import { notImplemented } from '../../_lib/responses.js';

export async function onRequestPost(context) {
  const { request, params } = context;
  const uploadId = params.upload_id;

  // TODO(auth): validate the real session token here (spec 12 §5/§6).
  const sessionCheck = requireSession(request);
  if (!sessionCheck.ok) {
    return sessionCheck.response;
  }

  // TODO(ownership): confirm the validated session owns :upload_id BEFORE
  // any file registration is attempted (spec 12 §6/§7, spec 20 §6).
  const ownershipCheck = requireOwnership(sessionCheck.session, uploadId);
  if (!ownershipCheck.ok) {
    return ownershipCheck.response;
  }

  // TODO(implementation): register the file's PRIVATE storage reference
  // once storage buckets exist (spec 19 §10/§11). Never accept or return a
  // public URL — private object storage only, mediated by short-lived
  // signed access (spec 11 §5, spec 18 §17).
  // This route does not accept or process real policy files yet.
  return notImplemented('POST /api/uploads/:upload_id/files');
}
