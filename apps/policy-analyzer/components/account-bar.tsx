import Link from "next/link";
import { getSessionActor } from "@/lib/auth/session";
import { demoAnonymousAuthEnabled } from "@/lib/persistence/config";

export async function AccountBar() {
  const actor = await getSessionActor();
  const demo = demoAnonymousAuthEnabled();
  if (!actor) {
    return (
      <Link href="/sign-in" className="text-xs text-white/90 underline-offset-2 hover:underline">
        {demo ? "Start Demo" : "Sign in"}
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-white/90">
      <span>{actor.email || (demo ? "Demo session" : "Signed in")}</span>
      <form action="/auth/sign-out" method="post">
        <button type="submit" className="underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
