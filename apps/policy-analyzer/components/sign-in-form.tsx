"use client";

import { useState } from "react";
import { createBrowserSupabase } from "@/lib/auth/browser";
import { isLocalDisposableAuthUrl } from "@/lib/auth/local-disposable";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function localDisposableSignIn(): boolean {
  return isLocalDisposableAuthUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
}

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const localStack = localDisposableSignIn();

  async function sendLink(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const supabase = createBrowserSupabase();
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`
        }
      });
      if (otpError) {
        setError("Could not send a sign-in link.");
        return;
      }
      setSent(true);
      setMessage("Check your email for a sign-in link or one-time code.");
    } catch {
      setError("Authentication is not configured on this server.");
    }
  }

  async function signInLocalPassword(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!localDisposableSignIn()) {
      setError("Password sign-in is only available on the disposable local stack.");
      return;
    }
    try {
      const supabase = createBrowserSupabase();
      const { error: passwordError } = await supabase.auth.signInWithPassword({ email, password });
      if (passwordError) {
        setError("That local sign-in is not valid.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Authentication is not configured on this server.");
    }
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const supabase = createBrowserSupabase();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email"
      });
      if (verifyError) {
        setError("That code is not valid.");
        return;
      }
      window.location.assign("/");
    } catch {
      setError("Authentication is not configured on this server.");
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
      <form onSubmit={sendLink} className="space-y-3">
        <label className="block text-sm font-medium text-[#0b3c5d]" htmlFor="email">
          Work email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
          autoComplete="email"
        />
        <button type="submit" className={cn(buttonVariants(), "bg-[#0b3c5d] hover:bg-[#144e78]")}>
          Email me a sign-in link
        </button>
      </form>
      {sent ? (
        <form onSubmit={verifyOtp} className="space-y-3 border-t border-[#e5e7eb] pt-4">
          <p className="text-sm text-[#4a5568]">{message}</p>
          <label className="block text-sm font-medium text-[#0b3c5d]" htmlFor="otp">
            One-time code
          </label>
          <input
            id="otp"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
            inputMode="numeric"
            autoComplete="one-time-code"
          />
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
            Verify code
          </button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-[#b91c1c]">{error}</p> : null}
      {localStack ? (
        <form onSubmit={signInLocalPassword} className="space-y-3 border-t border-[#e5e7eb] pt-4">
          <p className="text-sm text-[#4a5568]">
            This browser is pointed at a loopback Auth server. Use the disposable local login written by
            <code className="mx-1 text-xs">scripts/local-staging-session.mjs</code>
            — hosted staging still uses email.
          </p>
          <label className="block text-sm font-medium text-[#0b3c5d]" htmlFor="local-password">
            Local stack password
          </label>
          <input
            id="local-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-md border border-[#d1d5db] px-3 py-2 text-sm"
            autoComplete="current-password"
          />
          <button type="submit" className={cn(buttonVariants({ variant: "outline" }))}>
            Sign in on the local stack
          </button>
        </form>
      ) : null}
    </div>
  );
}
