import { NextResponse } from "next/server";
import { getUserStore } from "@/lib/auth/session";
import { isUuid } from "@/lib/original-document";
import { PRIVATE_HEADERS, jsonNotFound } from "@/lib/persistence/headers";
import { assertSameOrigin } from "@/lib/persistence/same-origin";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!assertSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  const { actor, store } = await getUserStore();
  const cancelled = await store.cancelJob(actor, id);
  if (!cancelled) {
    return NextResponse.json(jsonNotFound(), { status: 404, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json({ cancelled: true }, { headers: PRIVATE_HEADERS });
}
