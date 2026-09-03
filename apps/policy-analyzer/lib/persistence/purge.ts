import { MAX_PURGE_BATCH } from "./constants";
import { getMemoryStore, usesMemoryStore } from "./factory";
import { requireSupabaseConfig } from "./config";

/**
 * Server-side retention purge. Invoke from an authorized scheduler later.
 * There is no public HTTP route for this function.
 */
export async function purgeExpiredAnalyses(limit = MAX_PURGE_BATCH): Promise<{ purged: number }> {
  const batch = Math.max(1, Math.min(limit, MAX_PURGE_BATCH));
  if (usesMemoryStore()) {
    return getMemoryStore().purgeExpired(batch);
  }
  requireSupabaseConfig();
  const { createAdminClient } = await import("./admin-client");
  const { SupabasePolicyStore } = await import("./supabase-store");
  return new SupabasePolicyStore(createAdminClient()).purgeExpired(batch);
}
