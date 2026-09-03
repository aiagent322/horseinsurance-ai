import { NextResponse } from "next/server";
import { loadPolicy } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rec = await loadPolicy(id);
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  return NextResponse.json(safe, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { deletePolicy } = await import("@/lib/store");
  const ok = await deletePolicy(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
