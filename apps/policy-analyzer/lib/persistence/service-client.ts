import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigurationError, serviceRoleKey, supabaseUrl } from "./config";
import { assertServiceRoleModuleAllowed } from "./service-role-boundary";

export function requireWorkerSupabaseConfig(): { url: string; serviceRoleKey: string } {
  assertServiceRoleModuleAllowed();
  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    throw new ConfigurationError("Worker requires a Supabase URL and service-role key.");
  }
  return { url, serviceRoleKey: key };
}

export function createServiceRoleClient(): SupabaseClient {
  assertServiceRoleModuleAllowed();
  const { url, serviceRoleKey: key } = requireWorkerSupabaseConfig();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
