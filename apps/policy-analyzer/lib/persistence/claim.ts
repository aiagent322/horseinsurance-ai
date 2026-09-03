import type { ClaimedJob } from "./types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/i;

export class MalformedClaimError extends Error {
  readonly code = "malformed_claim" as const;
  constructor() {
    super("malformed_claim");
    this.name = "MalformedClaimError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function requireUuid(value: unknown): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) throw new MalformedClaimError();
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new MalformedClaimError();
  return value;
}

export function parseClaimedJob(raw: unknown): ClaimedJob {
  const row = asRecord(raw);
  if (!row) throw new MalformedClaimError();

  const jobId = requireUuid(row.job_id ?? row.jobId);
  const policyId = requireUuid(row.policy_id ?? row.policyId);
  const analysisId = requireUuid(row.analysis_id ?? row.analysisId);
  const accountId = requireUuid(row.account_id ?? row.accountId);
  const ownerUserId = requireUuid(row.owner_user_id ?? row.ownerUserId);
  const sessionId = requireUuid(row.session_id ?? row.sessionId);
  const attemptCount = Number(row.attempt_count ?? row.attemptCount);
  if (!Number.isInteger(attemptCount) || attemptCount < 1) throw new MalformedClaimError();

  const filesRaw = row.files;
  if (!Array.isArray(filesRaw) || filesRaw.length < 1) throw new MalformedClaimError();

  const files = filesRaw.map((entry) => {
    const file = asRecord(entry);
    if (!file) throw new MalformedClaimError();
    const documentId = requireUuid(file.document_id ?? file.documentId);
    const fileId = requireUuid(file.file_id ?? file.fileId);
    const path = requireString(file.storage_path ?? file.path);
    if (path.includes("..") || /https?:\/\//i.test(path) || path.includes("?")) {
      throw new MalformedClaimError();
    }
    const sha256 = requireString(file.sha256 ?? file.file_sha256).toLowerCase();
    if (!SHA_RE.test(sha256)) throw new MalformedClaimError();
    const filename = typeof file.filename === "string" && file.filename.trim()
      ? file.filename
      : typeof file.original_filename === "string" && file.original_filename.trim()
        ? file.original_filename
        : `${fileId}.pdf`;
    return { documentId, fileId, path, sha256, filename };
  });

  return {
    jobId,
    policyId,
    analysisId,
    accountId,
    ownerUserId,
    attemptCount,
    files,
    sessionId
  };
}

export function parseClaimedJobs(raw: unknown): ClaimedJob[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new MalformedClaimError();
  return raw.map(parseClaimedJob);
}

export type RecoverableClaimIdentity = {
  jobId: string;
  workerId: string;
};

export type MalformedClaimDecision =
  | { action: "terminalize"; jobId: string; workerId: string }
  | {
      action: "leave";
      reason:
        | "missing_job_identity"
        | "invalid_job_identity"
        | "invalid_lease_identity"
        | "missing_worker"
        | "unreadable_row";
    };

function readLeaseWorkerId(row: Record<string, unknown>): string | undefined {
  const raw = row.claimed_by ?? row.lease_owner ?? row.leaseOwner ?? row.worker_id ?? row.workerId;
  if (raw == null) return undefined;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw;
}

export function decideMalformedClaimAction(input: {
  raw: unknown;
  claimingWorkerId: string;
}): MalformedClaimDecision {
  if (typeof input.claimingWorkerId !== "string" || !input.claimingWorkerId.trim()) {
    return { action: "leave", reason: "missing_worker" };
  }
  const row = asRecord(input.raw);
  if (!row) return { action: "leave", reason: "unreadable_row" };
  const jobIdRaw = row.job_id ?? row.jobId;
  if (jobIdRaw == null || jobIdRaw === "") {
    return { action: "leave", reason: "missing_job_identity" };
  }
  if (typeof jobIdRaw !== "string" || !UUID_RE.test(jobIdRaw)) {
    return { action: "leave", reason: "invalid_job_identity" };
  }
  const lease = readLeaseWorkerId(row);
  if (lease !== undefined && lease !== input.claimingWorkerId) {
    return { action: "leave", reason: "invalid_lease_identity" };
  }
  return { action: "terminalize", jobId: jobIdRaw, workerId: input.claimingWorkerId };
}

export function recoverTrustedClaimIdentity(
  raw: unknown,
  claimingWorkerId: string
): RecoverableClaimIdentity | null {
  const decision = decideMalformedClaimAction({ raw, claimingWorkerId });
  if (decision.action !== "terminalize") return null;
  return { jobId: decision.jobId, workerId: decision.workerId };
}

export function inspectClaimBatch(
  raw: unknown,
  claimingWorkerId: string
): {
  jobs: ClaimedJob[];
  recoverable: RecoverableClaimIdentity[];
  untrustedCount: number;
} {
  if (raw == null) return { jobs: [], recoverable: [], untrustedCount: 0 };
  if (!Array.isArray(raw)) {
    return { jobs: [], recoverable: [], untrustedCount: 1 };
  }
  const jobs: ClaimedJob[] = [];
  const recoverable: RecoverableClaimIdentity[] = [];
  let untrustedCount = 0;
  for (const entry of raw) {
    try {
      jobs.push(parseClaimedJob(entry));
    } catch {
      const identity = recoverTrustedClaimIdentity(entry, claimingWorkerId);
      if (identity) recoverable.push(identity);
      else untrustedCount += 1;
    }
  }
  return { jobs, recoverable, untrustedCount };
}
