import Link from "next/link";
import { getSessionActor } from "@/lib/auth/session";

export async function AccountBar() {
  const actor = await getSessionActor();
  if (!actor?.email) {
    return (
      <Link href="/sign-in" className="text-xs text-white/90 underline-offset-2 hover:underline">
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-white/90">
      <span>{actor.email}</span>
      <form action="/auth/sign-out" method="post">
        <button type="submit" className="underline-offset-2 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
