import { NextResponse } from "next/server";
import { isUuid, loadPolicyRecord, originalFileHeaders, resolveOriginalPdf } from "@/lib/original-document";
import { PRIVATE_HEADERS, jsonNotFound } from "@/lib/persistence/headers";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  const rec = await loadPolicyRecord(id);
  if (!rec?.documents[0]) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  const original = await resolveOriginalPdf(id, rec.documents[0].document_id);
  if (!original) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  return new NextResponse(Uint8Array.from(original.bytes), {
    headers: originalFileHeaders(original.filename)
  });
}
