import type { ClaimedJob, WorkerPersistence } from "@/lib/persistence/types";
import { MalformedClaimError } from "@/lib/persistence/claim";
import { WorkerRpcError } from "@/lib/persistence/worker-store";
import type { WorkerConfig } from "./config";
import { WorkerJobError } from "./errors";
import { operationalLog } from "./log";
import { processClaimedJob, type ProcessJobDeps, type ProcessJobResult } from "./process-job";

export type WorkerCounters = {
  claimed: number;
  completed: number;
  needs_review: number;
  failed: number;
  retried: number;
  cancelled: number;
};

export type OnceResult = {
  claimed: number;
  results: ProcessJobResult[];
  counters: WorkerCounters;
};

function emptyCounters(): WorkerCounters {
  return { claimed: 0, completed: 0, needs_review: 0, failed: 0, retried: 0, cancelled: 0 };
}

function tally(counters: WorkerCounters, result: ProcessJobResult): void {
  if (result.outcome === "completed") counters.completed += 1;
  else if (result.outcome === "needs_review") counters.needs_review += 1;
  else if (result.outcome === "retried") counters.retried += 1;
  else if (result.outcome === "cancelled") counters.cancelled += 1;
  else counters.failed += 1;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function jitter(base: number): number {
  const spread = Math.floor(base * 0.3);
  return base + Math.floor(Math.random() * (spread + 1));
}

export class AnalysisWorker {
  readonly counters = emptyCounters();
  private stopping = false;
  private readonly active = new Set<Promise<void>>();
  private readonly abort = new AbortController();
  readonly config: WorkerConfig;
  private readonly store: WorkerPersistence;
  private readonly deps?: ProcessJobDeps;
  private readonly processFn: typeof processClaimedJob;

  constructor(options: {
    store: WorkerPersistence;
    config: WorkerConfig;
    deps?: ProcessJobDeps;
    processJob?: typeof processClaimedJob;
  }) {
    this.store = options.store;
    this.config = options.config;
    this.deps = options.deps;
    this.processFn = options.processJob ?? processClaimedJob;
  }

  get activeCount(): number {
    return this.active.size;
  }

  get stoppingRequested(): boolean {
    return this.stopping;
  }

  requestStop(): void {
    this.stopping = true;
    this.abort.abort();
  }

  installSignals(): () => void {
    const onStop = () => this.requestStop();
    process.on("SIGTERM", onStop);
    process.on("SIGINT", onStop);
    return () => {
      process.off("SIGTERM", onStop);
      process.off("SIGINT", onStop);
    };
  }

  private async runOne(job: ClaimedJob): Promise<ProcessJobResult> {
    operationalLog({
      event: "job_claimed",
      worker_id: this.config.workerId,
      job_id: job.jobId,
      analysis_id: job.analysisId,
      attempt: job.attemptCount,
      stage: "processing"
    });
    const result = await this.processFn(this.store, job, this.config.workerId, {
      heartbeatMs: this.config.heartbeatMs,
      signal: this.abort.signal,
      deps: this.deps
    });
    tally(this.counters, result);
    return result;
  }

  async runOnce(): Promise<OnceResult> {
    if (this.stopping) {
      return { claimed: 0, results: [], counters: this.counters };
    }
    const limit = Math.min(this.config.claimLimit, this.config.concurrency);
    let claimed: ClaimedJob[];
    try {
      claimed = await this.store.claimJobs(this.config.workerId, limit);
    } catch (err) {
      if (err instanceof MalformedClaimError) {
        throw new WorkerJobError("malformed_claim", false, "processing");
      }
      if (err instanceof WorkerRpcError) throw err;
      throw new WorkerRpcError();
    }
    this.counters.claimed += claimed.length;
    if (!claimed.length) {
      return { claimed: 0, results: [], counters: this.counters };
    }

    const results: ProcessJobResult[] = [];
    const queue = [...claimed];
    const workers = Math.min(this.config.concurrency, queue.length);
    const runNext = async (): Promise<void> => {
      while (queue.length) {
        if (this.stopping) break;
        const job = queue.shift();
        if (!job) break;
        const pending = this.runOne(job).then((result) => {
          results.push(result);
        });
        this.active.add(pending);
        try {
          await pending;
        } finally {
          this.active.delete(pending);
        }
      }
    };
    await Promise.all(Array.from({ length: workers }, () => runNext()));
    if (this.stopping && this.active.size) {
      await this.waitForActive();
    }
    return { claimed: claimed.length, results, counters: { ...this.counters } };
  }

  private async waitForActive(): Promise<void> {
    const timeout = this.config.shutdownMs;
    const started = Date.now();
    await Promise.race([
      Promise.allSettled([...this.active]),
      sleep(timeout)
    ]);
    void started;
  }

  async runLoop(): Promise<void> {
    let idlePolls = 0;
    while (!this.stopping) {
      const started = Date.now();
      try {
        const once = await this.runOnce();
        if (once.claimed === 0) {
          idlePolls += 1;
          const delay = Math.min(this.config.backoffMaxMs, jitter(this.config.pollMs * Math.min(idlePolls, 8)));
          try {
            await sleep(delay, this.abort.signal);
          } catch {
            break;
          }
        } else {
          idlePolls = 0;
        }
      } catch (err) {
        if (err instanceof WorkerRpcError || err instanceof WorkerJobError) {
          operationalLog({
            event: "worker_poll_error",
            worker_id: this.config.workerId,
            error_code: err instanceof WorkerJobError ? err.code : "infrastructure_failure"
          });
          try {
            await sleep(Math.min(this.config.backoffMaxMs, jitter(this.config.pollMs * 4)), this.abort.signal);
          } catch {
            break;
          }
          continue;
        }
        throw err;
      }
      const elapsed = Date.now() - started;
      if (!this.stopping && elapsed < this.config.pollMs && idlePolls === 0) {
        try {
          await sleep(this.config.pollMs - elapsed, this.abort.signal);
        } catch {
          break;
        }
      }
    }
    await this.waitForActive();
    operationalLog({
      event: "worker_stopped",
      worker_id: this.config.workerId,
      claimed: this.counters.claimed,
      completed: this.counters.completed,
      needs_review: this.counters.needs_review,
      failed: this.counters.failed,
      retried: this.counters.retried,
      cancelled: this.counters.cancelled
    });
  }
}

export async function runWorkerOnce(options: {
  store: WorkerPersistence;
  config: WorkerConfig;
  deps?: ProcessJobDeps;
}): Promise<OnceResult> {
  const worker = new AnalysisWorker(options);
  return worker.runOnce();
}
