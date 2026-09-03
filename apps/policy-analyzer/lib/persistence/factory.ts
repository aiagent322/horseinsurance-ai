import { ConfigurationError, isProduction, isProtectedDeploy, requireSupabaseConfig } from "./config";
import { MemoryPolicyStore } from "./memory-store";
import { SupabasePolicyStore } from "./supabase-store";
import type { PolicyStore } from "./types";

let memoryStore: MemoryPolicyStore | undefined;

export function usesMemoryStore(): boolean {
  return process.env.POLICY_ANALYZER_STORE === "memory";
}

export function getMemoryStore(): MemoryPolicyStore {
  if (isProtectedDeploy() || isProduction()) {
    throw new ConfigurationError("Memory store is not allowed in staging or production.");
  }
  if (!memoryStore) memoryStore = new MemoryPolicyStore();
  return memoryStore;
}

export function resetMemoryStoreForTests(): MemoryPolicyStore {
  memoryStore = new MemoryPolicyStore();
  return memoryStore;
}

export function createPolicyStore(userClient?: import("@supabase/supabase-js").SupabaseClient): PolicyStore {
  if (usesMemoryStore()) {
    if (isProtectedDeploy() || isProduction()) {
      throw new ConfigurationError("Memory store is not allowed in staging or production.");
    }
    return getMemoryStore();
  }
  requireSupabaseConfig();
  if (!userClient) {
    throw new ConfigurationError("A user-scoped Supabase client is required.");
  }
  return new SupabasePolicyStore(userClient);
}

export function getPolicyStore(userClient?: import("@supabase/supabase-js").SupabaseClient): PolicyStore {
  return createPolicyStore(userClient);
}
