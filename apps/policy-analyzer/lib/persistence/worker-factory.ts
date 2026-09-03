import { ConfigurationError, isProduction, isProtectedDeploy } from "./config";
import { getMemoryStore, usesMemoryStore } from "./factory";
import { requireWorkerSupabaseConfig } from "./service-client";
import type { WorkerPersistence } from "./types";
import { SupabaseWorkerStore } from "./worker-store";

export function createWorkerPersistence(): WorkerPersistence {
  if ((isProtectedDeploy() || isProduction()) && usesMemoryStore()) {
    throw new ConfigurationError("Memory store is not allowed in staging or production.");
  }
  if (usesMemoryStore()) {
    return getMemoryStore();
  }
  requireWorkerSupabaseConfig();
  return new SupabaseWorkerStore();
}
