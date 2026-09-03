import type { WorkerPersistence } from "@/lib/persistence/types";
import { operationalLog } from "./log";

export type RecoverableClaimIdentity = {
  jobId: string;
  workerId: string;
};

export async function terminalizeRecoverableMalformedClaims(
  store: Pick<WorkerPersistence, "failJob">,
  identities: RecoverableClaimIdentity[]
): Promise<{ terminalized: number; leftUntrusted: number }> {
  let terminalized = 0;
  let leftUntrusted = 0;
  for (const identity of identities) {
    const recorded = await store.failJob(
      identity.jobId,
      identity.workerId,
      "malformed_claim",
      "processing",
      false
    );
    operationalLog({
      event: "malformed_claim",
      worker_id: identity.workerId,
      job_id: identity.jobId,
      error_code: "malformed_claim",
      outcome: recorded ? "failed" : "lease_lost"
    });
    if (recorded) terminalized += 1;
    else leftUntrusted += 1;
  }
  return { terminalized, leftUntrusted };
}
