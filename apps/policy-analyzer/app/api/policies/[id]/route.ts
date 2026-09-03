import { NextResponse } from "next/server";
import { deletePolicyRecord, loadPolicyRecord } from "@/lib/original-document";
import { PRIVATE_HEADERS, jsonNotFound } from "@/lib/persistence/headers";
import { assertSameOrigin } from "@/lib/persistence/same-origin";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const rec = await loadPolicyRecord(id);
  if (!rec) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  const safe = {
    ...rec,
    documents: rec.documents.map((d) => ({
      ...d,
      storage_location: undefined,
      pages: d.pages.map((p) => ({
        page: p.page,
        text: p.text,
        extraction_method: p.extraction_method,
        character_count: p.character_count,
        word_count: p.word_count,
        alphanumeric_ratio: p.alphanumeric_ratio,
        quality_status: p.quality_status,
        ocr_attempted: p.ocr_attempted,
        ocr_succeeded: p.ocr_succeeded,
        diagnostic_warnings: p.diagnostic_warnings,
        confidence: p.confidence
      }))
    }))
  };
  return NextResponse.json(safe, { headers: PRIVATE_HEADERS });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!assertSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const { id } = await params;
  const result = await deletePolicyRecord(id);
  if (result !== "deleted") {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json({ deleted: true }, { headers: PRIVATE_HEADERS });
}
