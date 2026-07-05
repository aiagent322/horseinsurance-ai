/**
 * HorseInsurance.ai — Coverage Checkup API Skeleton
 * functions/api/health.js
 *
 * Route: GET /api/health
 * Purpose: Health/status check — service liveness only. No user data,
 * no auth, no database. (spec 20 §7, §8)
 *
 * SKELETON ONLY. No Supabase connection. No real service checks yet.
 */

import { jsonOk } from './_lib/responses.js';

export async function onRequestGet(context) {
  // No session/ownership checks required for this route (spec 20 §8).
  // No policy text, no user data, no external calls — safe local response.
  return jsonOk({
    status: 'ok',
    service: 'horseinsurance-ai-coverage-checkup-api',
    mode: 'skeleton',
  });
}
