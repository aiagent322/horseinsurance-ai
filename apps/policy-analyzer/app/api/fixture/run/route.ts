import { NextResponse } from "next/server";
import { buildFixturePdf } from "@/lib/build-fixture";
import { ingestPdfBuffer } from "@/lib/ingest";

export const runtime = "nodejs";

async function run(req: Request) {
  const buf = await buildFixturePdf();
  const result = await ingestPdfBuffer(buf, "horseinsurance-educational-fixture.pdf");
  return NextResponse.redirect(new URL(`/analysis/${result.policy_id}`, req.url), 303);
}

export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}
