import { UploadForm } from "@/components/upload-form";
import { getSessionActor } from "@/lib/auth/session";
import { supabaseConfigured } from "@/lib/persistence/config";
import Link from "next/link";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const actor = await getSessionActor();
  const configured = supabaseConfigured() || process.env.POLICY_ANALYZER_STORE === "memory";

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
          Upload policy → sourced report
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-[#0b3c5d] sm:text-4xl">
          What does this policy actually say?
        </h1>
        <p className="max-w-2xl text-[15px] leading-relaxed text-[#4a5568]">
          Upload one or more equine insurance PDFs. The analyzer inventories every document, extracts facts that appear
          in readable pages, and writes a plain-English report with page citations. It will not invent customary
          coverage that is not in the file.
        </p>
      </section>
      {!configured ? (
        <div className="rounded-xl border border-[#e5e7eb] bg-white p-5 text-sm text-[#4a5568]">
          Analyzer persistence is not configured. Set the Supabase URL and publishable key. Missing configuration
          fails closed; uploads are not stored on disk.
        </div>
      ) : !actor ? (
        <div className="space-y-3 rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-[#0b3c5d]">Sign in required</h2>
          <p className="text-sm text-[#4a5568]">
            Policy uploads, reports, original documents, and deletion are available only after you sign in. An
            educational sample PDF can still be downloaded; running it as a stored analysis also requires an account.
          </p>
          <Link href="/sign-in" className="inline-block text-sm font-medium text-[#1d6fa5] underline">
            Sign in to continue
          </Link>
          <p className="text-xs text-[#6b7280]">
            <a className="underline" href="/api/fixture">
              Download the educational sample PDF
            </a>{" "}
            (no customer data). Running it as a stored analysis requires a signed-in account.
          </p>
        </div>
      ) : (
        <UploadForm errorCode={error} />
      )}
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ["The upload is the authority", "Endorsements and declarations outrank general insurance knowledge."],
          ["No coverage score", "Status is COVERED, LIMITED, EXCLUDED, NOT FOUND, or NEEDS CLARIFICATION."],
          ["Conflicts stay visible", "If two pages disagree, both are shown. Nothing is quietly preferred."]
        ].map(([t, d]) => (
          <div key={t} className="rounded-lg border border-[#e5e7eb] bg-white p-4">
            <h2 className="text-sm font-semibold text-[#0b3c5d]">{t}</h2>
            <p className="mt-1 text-sm text-[#4a5568]">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
