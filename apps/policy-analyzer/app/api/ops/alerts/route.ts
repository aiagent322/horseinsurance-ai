import { NextResponse } from "next/server";
import { evaluateAlertConditions, evaluateWebReadiness } from "@/lib/deploy/readiness";
import { PRIVATE_HEADERS } from "@/lib/persistence/headers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = (process.env.POLICY_ANALYZER_OPS_TOKEN || "").trim();
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  return header === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
  }
  const url = new URL(req.url);
  const readiness = evaluateWebReadiness({
    supabaseReachable: url.searchParams.get("database") !== "down",
    storageReachable: url.searchParams.get("storage") !== "down",
    schemaVersion: url.searchParams.get("schema_version"),
    bucketPrivate: url.searchParams.get("bucket") !== "public"
  });
  const alerts = evaluateAlertConditions({
    ready: readiness.ready,
    workerLastSuccessAgeMs: Number(url.searchParams.get("worker_idle_ms") || 0) || undefined,
    oldestQueuedAgeMs: Number(url.searchParams.get("queue_age_ms") || 0) || undefined,
    queueAgeThresholdMs: Number(url.searchParams.get("queue_threshold_ms") || 300_000),
    ocrTimeouts: Number(url.searchParams.get("ocr_timeouts") || 0),
    storageFailures: Number(url.searchParams.get("storage_failures") || 0),
    attemptsExhausted: Number(url.searchParams.get("attempts_exhausted") || 0),
    needsReview: Number(url.searchParams.get("needs_review") || 0),
    completed: Number(url.searchParams.get("completed") || 0),
    migrationMismatch: readiness.checks.some((check) => check.code === "migration_mismatch"),
    retentionFailure: url.searchParams.get("retention") === "failed"
  });
  return NextResponse.json({ alerts, ready: readiness.ready }, { headers: PRIVATE_HEADERS });
}
