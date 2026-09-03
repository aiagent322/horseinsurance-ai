import { actorFromContext } from "@/lib/persistence/actor-context";
import { AuthRequiredError, supabaseConfigured } from "@/lib/persistence/config";
import { getPolicyStore, usesMemoryStore } from "@/lib/persistence/factory";
import type { Actor } from "@/lib/persistence/types";

export async function getSessionActor(): Promise<Actor | null> {
  const contextual = actorFromContext();
  if (contextual) return contextual;
  if (usesMemoryStore()) return null;
  if (!supabaseConfigured()) return null;
  const { createServerSupabase } = await import("./server");
  const supabase = await createServerSupabase();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return null;
  const store = getPolicyStore(supabase);
  const { accountId } = await store.ensureAccount(user.id);
  return {
    userId: user.id,
    accountId,
    role: "owner",
    email: user.email || undefined
  };
}

export async function requireSessionActor(): Promise<Actor> {
  const actor = await getSessionActor();
  if (!actor) throw new AuthRequiredError();
  return actor;
}

export async function getUserStore() {
  const contextual = actorFromContext();
  if (contextual && usesMemoryStore()) {
    return { actor: contextual, store: getPolicyStore() };
  }
  if (usesMemoryStore()) {
    return { actor: null, store: getPolicyStore() };
  }
  const { createServerSupabase } = await import("./server");
  const supabase = await createServerSupabase();
  const actor = await getSessionActor();
  return { actor, store: getPolicyStore(supabase) };
}
