import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig, supabaseConfigured } from "@/lib/persistence/config";

export async function createServerSupabase() {
  const { url, anonKey } = requireSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always set cookies; middleware refresh handles that.
        }
      }
    }
  });
}

export function canCreateServerSupabase(): boolean {
  return supabaseConfigured();
}
