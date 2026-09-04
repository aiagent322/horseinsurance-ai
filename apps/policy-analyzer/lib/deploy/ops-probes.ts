import { createServiceRoleClient } from "@/lib/persistence/service-client";
import { parseOpsSnapshot, type AnalyzerOpsSnapshot, type OpsFetchError } from "./ops-snapshot";

export type OpsFetchResult =
  | { ok: true; snapshot: AnalyzerOpsSnapshot }
  | { ok: false; error: OpsFetchError };

export type OpsFetcher = () => Promise<OpsFetchResult>;

const DEFAULT_TIMEOUT_MS = 2_500;

let testFetcher: OpsFetcher | null = null;

export function setOpsFetcherForTests(fetcher: OpsFetcher | null): void {
  testFetcher = fetcher;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function fetchLiveOpsSnapshot(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<OpsFetchResult> {
  if (testFetcher) return testFetcher();
  try {
    const client = createServiceRoleClient();
    const rpc = Promise.resolve(client.rpc("analyzer_ops_snapshot"));
    const { data, error } = (await withTimeout(rpc, timeoutMs)) as { data: unknown; error: unknown };
    if (error) return { ok: false, error: "rpc_error" };
    const snapshot = parseOpsSnapshot(data);
    if (!snapshot) return { ok: false, error: "malformed" };
    return { ok: true, snapshot };
  } catch (error) {
    if (error instanceof Error && error.message === "timeout") return { ok: false, error: "timeout" };
    return { ok: false, error: "unavailable" };
  }
}
