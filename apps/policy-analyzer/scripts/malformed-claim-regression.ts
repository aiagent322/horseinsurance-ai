import assert from "node:assert/strict";
import { decideMalformedClaimAction, inspectClaimBatch, recoverTrustedClaimIdentity } from "../lib/persistence/claim";
import { terminalizeRecoverableMalformedClaims } from "../lib/worker/malformed-claim";
import { operationalLog } from "../lib/worker/log";

const JOB = "11111111-1111-4111-8111-111111111111";
const WORKER = "w-trusted";

function capturedLogs(fn: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "));
  };
  return Promise.resolve(fn()).then(
    () => {
      console.log = original;
      return lines;
    },
    (err) => {
      console.log = original;
      throw err;
    }
  );
}

async function main(): Promise<void> {
  const trusted = decideMalformedClaimAction({
    raw: { job_id: JOB, worker_id: WORKER, files: "bad", secret_payload: "EQUINE MEDICAL POLICY" },
    claimingWorkerId: WORKER
  });
  assert.deepEqual(trusted, { action: "terminalize", jobId: JOB, workerId: WORKER });
  assert.ok(recoverTrustedClaimIdentity({ job_id: JOB, worker_id: WORKER }, WORKER));

  assert.equal(
    decideMalformedClaimAction({ raw: { worker_id: WORKER }, claimingWorkerId: WORKER }).action,
    "leave"
  );
  assert.equal(
    decideMalformedClaimAction({ raw: { job_id: "nope", worker_id: WORKER }, claimingWorkerId: WORKER }).action,
    "leave"
  );
  const invalidLease = decideMalformedClaimAction({
    raw: { job_id: JOB, worker_id: "w-other" },
    claimingWorkerId: WORKER
  });
  assert.equal(invalidLease.action, "leave");
  if (invalidLease.action === "leave") assert.equal(invalidLease.reason, "invalid_lease_identity");

  const missingInput = decideMalformedClaimAction({ raw: { job_id: JOB }, claimingWorkerId: "" });
  assert.equal(missingInput.action, "leave");

  const inspected = inspectClaimBatch(
    [
      { job_id: JOB, worker_id: WORKER, files: "bad" },
      { job_id: "nope", worker_id: WORKER },
      { worker_id: WORKER }
    ],
    WORKER
  );
  assert.equal(inspected.jobs.length, 0);
  assert.equal(inspected.recoverable.length, 1);
  assert.equal(inspected.untrustedCount, 2);

  const failed: string[] = [];
  const reports: unknown[] = [];
  const store = {
    async failJob(jobId: string, workerId: string, errorCode: string, _stage: string, retryable: boolean) {
      assert.equal(errorCode, "malformed_claim");
      assert.equal(retryable, false);
      failed.push(`${jobId}:${workerId}`);
      return true;
    },
    async completeJob() {
      reports.push("published");
    }
  };

  const lines = await capturedLogs(async () => {
    operationalLog({
      event: "malformed_claim",
      worker_id: WORKER,
      job_id: JOB,
      error_code: "malformed_claim"
    });
    const result = await terminalizeRecoverableMalformedClaims(store, inspected.recoverable);
    assert.equal(result.terminalized, 1);
  });
  assert.deepEqual(failed, [`${JOB}:${WORKER}`]);
  assert.deepEqual(reports, []);
  const blob = lines.join("\n");
  assert.match(blob, /malformed_claim/);
  assert.equal(/EQUINE MEDICAL|secret_payload|files":"bad"/i.test(blob), false);
  assert.equal(blob.includes(JOB), true);

  const bounded = await terminalizeRecoverableMalformedClaims(store, inspected.recoverable);
  assert.equal(bounded.terminalized, 1);
  assert.equal(failed.length, 2, "terminalize remains bounded to failJob; it does not republish or loop claims");

  console.log("MALFORMED CLAIM OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
