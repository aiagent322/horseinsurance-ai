import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/auth/server";
import { supabaseConfigured } from "@/lib/persistence/config";
import { PRIVATE_HEADERS } from "@/lib/persistence/headers";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (!supabaseConfigured() || !code) {
    return NextResponse.redirect(new URL("/sign-in", origin));
  }
  const supabase = await createServerSupabase();
  await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL("/", origin), { headers: PRIVATE_HEADERS });
}
