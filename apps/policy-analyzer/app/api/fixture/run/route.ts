import { NextResponse } from "next/server";
import { buildFixturePdf } from "@/lib/build-fixture";
import { ingestPdfBuffer } from "@/lib/ingest";
import { AuthRequiredError, ConfigurationError, isFixtureAnalysisEnabled } from "@/lib/persistence/config";
import { PRIVATE_HEADERS } from "@/lib/persistence/headers";
import { assertSameOrigin } from "@/lib/persistence/same-origin";

export const runtime = "nodejs";

async function run(req: Request) {
  if (req.method !== "GET" && !assertSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (!isFixtureAnalysisEnabled()) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: PRIVATE_HEADERS }
    );
  }
  try {
    const buf = await buildFixturePdf();
    const result = await ingestPdfBuffer(buf, "horseinsurance-educational-fixture.pdf", {
      source: "fixture"
    });
    return NextResponse.redirect(new URL(`/analysis/${result.policy_id}`, req.url), 303);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.redirect(new URL("/sign-in", req.url), 303);
    }
    if (err instanceof ConfigurationError) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
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
