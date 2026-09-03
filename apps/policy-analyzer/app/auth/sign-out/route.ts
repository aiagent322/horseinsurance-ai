import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/auth/server";
import { supabaseConfigured } from "@/lib/persistence/config";
import { PRIVATE_HEADERS } from "@/lib/persistence/headers";
import { assertSameOrigin } from "@/lib/persistence/same-origin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (supabaseConfigured()) {
    const supabase = await createServerSupabase();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/sign-in", request.url), 303);
}
