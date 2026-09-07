import { SignInForm } from "@/components/sign-in-form";
import { StartDemoButton } from "@/components/start-demo-button";
import { demoAnonymousAuthEnabled, supabaseConfigured } from "@/lib/persistence/config";

export default function SignInPage() {
  const configured = supabaseConfigured();
  const demo = demoAnonymousAuthEnabled();

  if (demo) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8860b]">Demo V1</p>
        <h1 className="text-3xl font-semibold text-[#0b3c5d]">Start Demo</h1>
        <p className="text-sm leading-relaxed text-[#4a5568]">
          No account or email required for this demonstration. This browser receives its own authenticated
          session. Uploads, reports, original documents, and deletion stay private to that session.
        </p>
        {configured ? (
          <div className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
            <StartDemoButton enabled={true} label="Start Demo" />
          </div>
        ) : (
          <div className="rounded-xl border border-[#e5e7eb] bg-white p-5 text-sm text-[#4a5568]">
            Authentication is not configured on this server. Set the Supabase URL and publishable key before using
            the analyzer.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8860b]">Account required</p>
      <h1 className="text-3xl font-semibold text-[#0b3c5d]">Sign in to analyze a policy</h1>
      <p className="text-sm leading-relaxed text-[#4a5568]">
        Uploads, reports, original documents, and deletion are private to your signed-in account. We email a
        one-time link. No password is stored by this analyzer.
      </p>
      {configured ? (
        <SignInForm />
      ) : (
        <div className="rounded-xl border border-[#e5e7eb] bg-white p-5 text-sm text-[#4a5568]">
          Authentication is not configured on this server. Set the Supabase URL and publishable key before using
          the analyzer.
        </div>
      )}
    </div>
  );
}
