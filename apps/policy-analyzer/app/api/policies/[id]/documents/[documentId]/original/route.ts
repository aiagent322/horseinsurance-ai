import { NextResponse } from "next/server";
import { originalFileHeaders, resolveOriginalPdf } from "@/lib/original-document";
import { PRIVATE_HEADERS, jsonNotFound } from "@/lib/persistence/headers";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const { id, documentId } = await params;
  const original = await resolveOriginalPdf(id, documentId);
  if (!original) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  return new NextResponse(Uint8Array.from(original.bytes), {
    headers: originalFileHeaders(original.filename)
  });
}
