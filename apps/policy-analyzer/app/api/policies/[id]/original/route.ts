import { NextResponse } from "next/server";
import { loadPolicy, readOriginal } from "@/lib/store";

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
  if (!rec?.documents[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const buf = await readOriginal(id, rec.documents[0].document_id);
  if (!buf) return NextResponse.json({ error: "Original not found" }, { status: 404 });
  return new NextResponse(Uint8Array.from(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${rec.documents[0].original_filename}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex"
    }
  });
}
