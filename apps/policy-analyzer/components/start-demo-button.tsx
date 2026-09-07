"use client";

import { useState } from "react";
import { ensureAnonymousBrowserSession } from "@/lib/auth/anonymous-start";
import { createBrowserSupabase } from "@/lib/auth/browser";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StartDemoButton({ enabled, label }: { enabled: boolean; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function startDemo() {
    setError("");
    if (!enabled) {
      setError("Anonymous demo sign-in is not enabled.");
      return;
    }
    setBusy(true);
    try {
      const supabase = createBrowserSupabase();
      await ensureAnonymousBrowserSession(supabase);
      window.location.assign("/");
    } catch {
      setError("Could not start the demo session. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy || !enabled}
        onClick={() => void startDemo()}
        className={cn(buttonVariants(), "bg-[#0b3c5d] hover:bg-[#144e78]")}
      >
        {busy ? "Starting…" : label}
      </button>
      {error ? <p className="text-sm text-[#b91c1c]">{error}</p> : null}
    </div>
  );
}
