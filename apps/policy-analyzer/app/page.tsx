import { UploadForm } from "@/components/upload-form";

export default async function HomePage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
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
      <UploadForm errorCode={error} />
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
