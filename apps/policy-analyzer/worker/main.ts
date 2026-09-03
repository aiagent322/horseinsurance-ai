import { ConfigurationError } from "../lib/persistence/config";
import { createWorkerPersistence } from "../lib/persistence/factory";
import { WorkerRpcError } from "../lib/persistence/worker-store";
import { loadWorkerConfig } from "../lib/worker/config";
import { operationalLog } from "../lib/worker/log";
import { AnalysisWorker } from "../lib/worker/runtime";

async function main(): Promise<void> {
  let worker: AnalysisWorker | undefined;
  try {
    const config = loadWorkerConfig();
    operationalLog({
      event: "worker_start",
      worker_id: config.workerId,
      concurrency: config.concurrency,
      poll_ms: config.pollMs,
      batch: config.claimLimit
    });
    const store = createWorkerPersistence();
    worker = new AnalysisWorker({ store, config });
    const uninstall = worker.installSignals();
    try {
      await worker.runLoop();
    } finally {
      uninstall();
    }
    process.exitCode = 0;
  } catch (err) {
    const code = err instanceof ConfigurationError ? "configuration" : "infrastructure_failure";
    void (err instanceof WorkerRpcError);
    operationalLog({
      event: "worker_failed",
      error_code: code,
      exit_code: 1
    });
    process.exitCode = 1;
  }
}

void main();
