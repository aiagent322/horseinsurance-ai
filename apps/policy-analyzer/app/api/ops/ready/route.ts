import { NextResponse } from "next/server";
import { fetchLiveOpsSnapshot } from "@/lib/deploy/ops-probes";
import { evaluateWebReadiness } from "@/lib/deploy/readiness";
import { ConfigurationError } from "@/lib/persistence/config";
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
  try {
    const fetched = await fetchLiveOpsSnapshot();
    const report = evaluateWebReadiness({
      snapshot: fetched.ok ? fetched.snapshot : null,
      fetchError: fetched.ok ? null : fetched.error
    });
    return NextResponse.json(report, {
      status: report.ready ? 200 : 503,
      headers: PRIVATE_HEADERS
    });
  } catch (err) {
    if (err instanceof ConfigurationError) {
      return NextResponse.json({ error: "configuration", ready: false }, { status: 503, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ error: "readiness_unavailable", ready: false }, { status: 503, headers: PRIVATE_HEADERS });
  }
}
