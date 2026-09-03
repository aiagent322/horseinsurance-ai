import { NextResponse } from "next/server";
import { getUserStore } from "@/lib/auth/session";
import { isUuid } from "@/lib/original-document";
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
  const { actor, store } = await getUserStore();
  const status = await store.getStatus(actor, id);
  if (!status) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json(status, { headers: PRIVATE_HEADERS });
}
