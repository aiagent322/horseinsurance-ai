import { NextResponse } from "next/server";
import { isUuid, originalFileHeaders } from "@/lib/original-document";
import { loadPolicy, readOriginal } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rec = await loadPolicy(id);
  if (!rec?.documents[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await readOriginal(id, rec.documents[0].document_id);
  if (!buf) return NextResponse.json({ error: "Original not found" }, { status: 404 });
  return new NextResponse(Uint8Array.from(buf), {
    headers: originalFileHeaders(rec.documents[0].original_filename)
  });
}
