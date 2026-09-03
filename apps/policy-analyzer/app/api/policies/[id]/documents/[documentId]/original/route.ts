import { NextResponse } from "next/server";
import { originalFileHeaders, resolveOriginalPdf } from "@/lib/original-document";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const { id, documentId } = await params;
  const original = await resolveOriginalPdf(id, documentId);
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(Uint8Array.from(original.bytes), {
    headers: originalFileHeaders(original.filename)
  });
}
