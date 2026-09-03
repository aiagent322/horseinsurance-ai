import { NextResponse } from "next/server";
import { buildFixturePdf } from "@/lib/build-fixture";
import { enqueuePolicyPackage } from "@/lib/enqueue";
import {
  AuthRequiredError,
  ConfigurationError,
  analyzerUploadsEnabled,
  isFixtureAnalysisEnabled
} from "@/lib/persistence/config";
import { PRIVATE_HEADERS } from "@/lib/persistence/headers";
import { BacklogLimitError, RateLimitError } from "@/lib/persistence/types";
import { assertSameOrigin } from "@/lib/persistence/same-origin";

export const runtime = "nodejs";

async function run(req: Request) {
  if (req.method !== "GET" && !assertSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (!isFixtureAnalysisEnabled() || !analyzerUploadsEnabled()) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: PRIVATE_HEADERS }
    );
  }
  try {
    const buf = await buildFixturePdf();
    const result = await enqueuePolicyPackage(
      [{ filename: "horseinsurance-educational-fixture.pdf", bytes: buf }],
      { source: "fixture" }
    );
    return NextResponse.redirect(new URL(`/analysis/${result.policy_id}`, req.url), 303);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.redirect(new URL("/sign-in", req.url), 303);
    }
    if (err instanceof ConfigurationError) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Too many analysis requests. Try again shortly." },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    if (err instanceof BacklogLimitError) {
      return NextResponse.json(
        { error: "Analysis backlog is full. Try again shortly." },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    throw err;
  }
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
