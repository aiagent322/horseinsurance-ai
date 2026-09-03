import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigurationError, requireSupabaseConfig, serviceRoleKey } from "./config";

export function createAdminClient(): SupabaseClient {
  const { url } = requireSupabaseConfig();
  const key = serviceRoleKey();
  if (!key) {
    throw new ConfigurationError("SUPABASE_SERVICE_ROLE_KEY is required for retention purge.");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
