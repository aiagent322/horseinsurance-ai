import { ConfigurationError } from "../lib/persistence/config";
import { createWorkerPersistence } from "../lib/persistence/factory";
import { WorkerRpcError } from "../lib/persistence/worker-store";
import { loadWorkerConfig } from "../lib/worker/config";
import { operationalLog } from "../lib/worker/log";
import { AnalysisWorker } from "../lib/worker/runtime";

async function main(): Promise<void> {
  let config;
  try {
    config = loadWorkerConfig();
    operationalLog({
      event: "worker_start",
      worker_id: config.workerId,
      concurrency: config.concurrency,
      poll_ms: config.pollMs,
      batch: config.claimLimit
    });
    const store = createWorkerPersistence();
    const worker = new AnalysisWorker({ store, config });
    const result = await worker.runOnce();
    operationalLog({
      event: "worker_once_done",
      worker_id: config.workerId,
      claimed: result.claimed,
      completed: result.counters.completed,
      needs_review: result.counters.needs_review,
      failed: result.counters.failed,
      retried: result.counters.retried,
      exit_code: 0
    });
    process.exitCode = 0;
  } catch (err) {
    const code =
      err instanceof ConfigurationError
        ? "configuration"
        : err instanceof WorkerRpcError
          ? "infrastructure_failure"
          : "infrastructure_failure";
    operationalLog({
      event: "worker_once_failed",
      error_code: code,
      exit_code: 1
    });
    process.exitCode = 1;
  }
}

void main();
