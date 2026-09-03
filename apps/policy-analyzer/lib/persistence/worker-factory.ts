import { ConfigurationError, isProduction } from "./config";
import { getMemoryStore, usesMemoryStore } from "./factory";
import { requireWorkerSupabaseConfig } from "./service-client";
import type { WorkerPersistence } from "./types";
import { SupabaseWorkerStore } from "./worker-store";

export function createWorkerPersistence(): WorkerPersistence {
  if (isProduction() && usesMemoryStore()) {
    throw new ConfigurationError("Memory store is not allowed in production.");
  }
  if (usesMemoryStore()) {
    if (isProduction()) {
      throw new ConfigurationError("Memory store is not allowed in production.");
    }
    return getMemoryStore();
  }
  requireWorkerSupabaseConfig();
  return new SupabaseWorkerStore();
}
