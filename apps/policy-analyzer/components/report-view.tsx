"use client";

import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { hydratePageDiagnostics, pageMethodCounts } from "@/lib/extraction-quality";
import { cn } from "@/lib/utils";
import type { AnalysisStatus, PolicyRecord, Sourced } from "@/lib/types";

function Status({ value }: { value: AnalysisStatus | string }) {
  const v = String(value);
  const tone =
    v === "COVERED"
      ? "bg-[#047857] text-white"
      : v.includes("LIMIT")
        ? "bg-[#b45309] text-white"
        : v === "EXCLUDED"
          ? "bg-[#b91c1c] text-white"
          : v === "POSSIBLE CONFLICT"
            ? "bg-[#b45309] text-white"
            : v === "NOT FOUND" || v === "MISSING"
              ? "bg-[#4a5568] text-white"
              : v === "PRESENT"
                ? "bg-[#047857] text-white"
                : v === "EDITION MISMATCH"
                  ? "bg-[#b45309] text-white"
              : "bg-[#1d6fa5] text-white";
  return <Badge className={`${tone} rounded-sm font-semibold tracking-wide`}>{v}</Badge>;
}

function Cite({ s }: { s?: Sourced<string> }) {
  if (!s) return <span className="text-[#6b7280]">NOT FOUND IN DOCUMENTS PROVIDED</span>;
  return (
    <span>
      {s.value}{" "}
      <span className="text-xs text-[#1d6fa5]">(p. {s.source_page})</span>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#e5e7eb] bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-[#0b3c5d]">{title}</h2>
      {children}
    </section>
  );
}

export function ReportView({ record, accountEmail }: { record: PolicyRecord; accountEmail?: string }) {
  const router = useRouter();
  const id = record.identification;
  const extractionIncomplete = record.documents.some(
    (d) => d.extraction_status && d.extraction_status !== "extracted" && d.extraction_status !== "pending"
  );

  async function onDelete() {
    if (!confirm("Delete this analysis and the uploaded PDF(s)?")) return;
    await fetch(`/api/policies/${record.policy_id}`, { method: "DELETE" });
    router.push("/");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8860b]">Policy report</p>
          <h1 className="mt-1 text-2xl font-semibold text-[#0b3c5d]">
            {id.insured_horse_name?.value || "Uploaded policy"}
          </h1>
          <p className="text-sm text-[#4a5568]">
            {record.documents.length} document{record.documents.length === 1 ? "" : "s"} ·{" "}
            {record.documents.reduce((n, d) => n + d.page_count, 0)} page
            {record.documents.reduce((n, d) => n + d.page_count, 0) === 1 ? "" : "s"}
          </p>
          {accountEmail ? <p className="mt-1 text-xs text-[#6b7280]">Signed in as {accountEmail}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            className={cn(buttonVariants({ variant: "outline" }))}
            href={`/api/policies/${record.policy_id}/original`}
            target="_blank"
            rel="noreferrer"
          >
            First original PDF
          </a>
          <Button variant="outline" onClick={onDelete}>
            Delete analysis
          </Button>
          <form action="/auth/sign-out" method="post">
            <button type="submit" className={cn(buttonVariants({ variant: "ghost" }))}>
              Sign out
            </button>
          </form>
        </div>
      </div>

      {extractionIncomplete ? (
        <div className="rounded-lg border border-[#b91c1c]/30 bg-[#fef2f2] p-4 text-sm text-[#991b1b]">
          <strong>Extraction is incomplete.</strong> One or more pages needed OCR or could not be read. Coverage
          conclusions use only pages with reliable text. Unreadable pages are not treated as policy language.
        </div>
      ) : null}

      {record.completeness.status === "DOCUMENT PACKAGE MAY BE INCOMPLETE" ? (
        <div className="rounded-lg border border-[#f59e0b] bg-[#fffbeb] p-4 text-sm text-[#92400e]">
          <strong>DOCUMENT PACKAGE MAY BE INCOMPLETE.</strong>{" "}
          {record.completeness.warnings.join(" ")} The report still proceeds from the pages that were readable.
        </div>
      ) : (
        <div className="rounded-lg border border-[#047857]/30 bg-[#ecfdf5] p-4 text-sm text-[#065f46]">
          Document package appears complete enough for this reading. That is not a guarantee every form the carrier
          issued is in the file.
        </div>
      )}

      <Section title="Policy Identification">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-[#6b7280]">Carrier</dt><dd><Cite s={id.carrier_name} /></dd></div>
          <div><dt className="text-[#6b7280]">Policy number</dt><dd><Cite s={id.policy_number} /></dd></div>
          <div><dt className="text-[#6b7280]">Named insured</dt><dd><Cite s={id.named_insured} /></dd></div>
          <div><dt className="text-[#6b7280]">Horse</dt><dd><Cite s={id.insured_horse_name} /></dd></div>
          <div><dt className="text-[#6b7280]">Registered name</dt><dd><Cite s={id.registered_name} /></dd></div>
          <div><dt className="text-[#6b7280]">Effective</dt><dd><Cite s={id.policy_effective_date} /></dd></div>
          <div><dt className="text-[#6b7280]">Expiration</dt><dd><Cite s={id.policy_expiration_date} /></dd></div>
          <div><dt className="text-[#6b7280]">Agency / agent</dt><dd><Cite s={id.agency_name} /> {id.agent_name ? <>/ <Cite s={id.agent_name} /></> : null}</dd></div>
          <div><dt className="text-[#6b7280]">Breed / age / sex</dt><dd>
            <Cite s={id.breed} />
            {id.age ? <> · age <Cite s={id.age} /></> : null}
            {id.sex ? <> · <Cite s={id.sex} /></> : null}
          </dd></div>
          <div><dt className="text-[#6b7280]">Stated use</dt><dd><Cite s={id.stated_use} /></dd></div>
        </dl>
      </Section>

      <Section title="Policy Document Inventory">
        <ul className="space-y-3 text-sm">
          {record.documents.map((d) => {
            const counts = pageMethodCounts(d.pages);
            const weakPages = d.pages
              .map(hydratePageDiagnostics)
              .filter((p) => p.quality_status !== "GOOD")
              .map((p) => p.page);
            return (
              <li key={d.document_id} className="rounded-md border border-[#f0f1f3] p-3">
                <p className="font-medium">{d.original_filename}</p>
                <p className="text-[#4a5568]">
                  Classified as {d.classification}; {d.page_count} page{d.page_count === 1 ? "" : "s"}; extraction{" "}
                  {d.extraction_status}; native text on {counts.native} page{counts.native === 1 ? "" : "s"}; OCR selected
                  on {counts.ocr} page{counts.ocr === 1 ? "" : "s"}
                  {weakPages.length
                    ? `; low-quality or unreadable pages: ${weakPages.join(", ")}`
                    : "; no low-quality pages"}
                  ; SHA-256 {d.file_hash.slice(0, 12)}…
                </p>
                <a
                  className="mt-1 inline-block text-xs font-medium text-[#1d6fa5] underline"
                  href={`/api/policies/${record.policy_id}/documents/${d.document_id}/original`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Original file
                </a>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Forms listed on the declarations">
        {record.form_inventory.length === 0 ? (
          <p className="text-sm text-[#6b7280]">
            No forms or endorsements schedule was identified. A listed form is not treated as uploaded just because its
            number appears on the declarations.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {record.form_inventory.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[#f0f1f3] pb-3 last:border-0">
                <div>
                  <p className="font-medium">
                    {f.printed_identifier}
                    {f.edition ? <span className="font-normal text-[#6b7280]"> · listed edition {f.edition}</span> : null}
                  </p>
                  <p className="text-xs text-[#1d6fa5]">
                    Listed p. {f.listing_page} — “{f.listing_source_text}”
                  </p>
                  {f.status === "PRESENT" || f.status === "EDITION MISMATCH" ? (
                    <p className="text-xs text-[#4a5568]">
                      Matching form p. {f.match_page}
                      {f.match_edition ? ` · uploaded edition ${f.match_edition}` : ""} — “{f.match_source_text}”
                    </p>
                  ) : (
                    <p className="text-xs text-[#6b7280]">
                      No separately sourced form text was found. The declarations list alone is not proof the form was
                      uploaded.
                    </p>
                  )}
                </div>
                <Status value={f.status} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Coverage Snapshot">
        <div className="space-y-3">
          {record.coverages.map((c) => (
            <div key={c.coverage_id} className="flex flex-wrap items-start justify-between gap-2 border-b border-[#f0f1f3] pb-3 last:border-0">
              <div>
                <p className="font-medium">{c.coverage_type}</p>
                <p className="text-sm text-[#4a5568]">{c.description}</p>
                {c.coverage_limit ? (
                  <p className="text-xs text-[#1d6fa5]">Limit {c.coverage_limit.value} · p. {c.coverage_limit.source_page}</p>
                ) : null}
              </div>
              <Status value={c.coverage_status} />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Mortality Coverage">
        {record.coverages.filter((c) => c.coverage_type.includes("Mortality")).map((c) => (
          <p key={c.coverage_id} className="text-sm">
            <Status value={c.coverage_status} />{" "}
            {c.coverage_limit ? <>Insured value {c.coverage_limit.value} (p. {c.coverage_limit.source_page}).</> : "No insured value found."}{" "}
            {c.source_text ? <span className="text-[#6b7280]">“{c.source_text}”</span> : null}
          </p>
        ))}
      </Section>

      <Section title="Major Medical / Surgical Coverage">
        <ul className="space-y-2 text-sm">
          {record.coverages
            .filter((c) => /Medical|Surgical|Colic/.test(c.coverage_type))
            .map((c) => (
              <li key={c.coverage_id}>
                <Status value={c.coverage_status} /> <strong>{c.coverage_type}</strong>
                {c.coverage_limit ? <> · {c.coverage_limit.value} (p. {c.coverage_limit.source_page})</> : null}
                {c.deductible ? <> · deductible {c.deductible.value} (p. {c.deductible.source_page})</> : null}
                {c.conditions ? <span className="block text-[#4a5568]">{c.conditions}</span> : null}
              </li>
            ))}
        </ul>
      </Section>

      <Section title="Colic Coverage">
        {record.coverages.filter((c) => c.coverage_type === "Colic Surgery").map((c) => (
          <p key={c.coverage_id} className="text-sm">
            <Status value={c.coverage_status} /> {c.conditions || c.description}{" "}
            {c.source_page > 0 ? <span className="text-xs text-[#1d6fa5]">(p. {c.source_page})</span> : null}
          </p>
        ))}
      </Section>

      <Section title="Loss of Use">
        {record.coverages.filter((c) => c.coverage_type === "Loss of Use").map((c) => (
          <p key={c.coverage_id} className="text-sm">
            <Status value={c.coverage_status} /> {c.description}{" "}
            {c.source_page > 0 ? <span className="text-xs text-[#1d6fa5]">(p. {c.source_page})</span> : null}
          </p>
        ))}
      </Section>

      <Section title="Exclusions">
        {record.exclusions.length === 0 ? (
          <p className="text-sm text-[#6b7280]">NOT FOUND IN DOCUMENTS PROVIDED</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {record.exclusions.map((e) => (
              <li key={e.exclusion_id}>
                <p className="font-medium">{e.exclusion_type}</p>
                <p>{e.description}</p>
                <p className="text-xs text-[#1d6fa5]">
                  p. {e.source_page} — “{e.exact_source_excerpt}”
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Deductibles, Limits & Sublimits">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-[#6b7280]">
                <th className="py-2 font-medium">Item</th>
                <th className="py-2 font-medium">Amount</th>
                <th className="py-2 font-medium">Page</th>
              </tr>
            </thead>
            <tbody>
              {record.financial_limits.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-3 text-[#6b7280]">
                    NOT FOUND IN DOCUMENTS PROVIDED
                  </td>
                </tr>
              ) : (
                record.financial_limits.map((f) => (
                  <tr key={f.id} className="border-b border-[#f0f1f3]">
                    <td className="py-2">{f.label}</td>
                    <td className="py-2">{f.amount}</td>
                    <td className="py-2">p. {f.source_page}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Emergency Requirements">
        {record.requirements.length === 0 ? (
          <p className="text-sm text-[#6b7280]">NOT FOUND IN DOCUMENTS PROVIDED</p>
        ) : (
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {record.requirements.map((r) => (
              <li key={r.id}>
                {r.requirement} <span className="text-xs text-[#1d6fa5]">(p. {r.source_page})</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Potential Conflicts">
        {record.conflicts.length === 0 ? (
          <p className="text-sm text-[#6b7280]">No contradictory dollar or date pairs were extracted.</p>
        ) : (
          record.conflicts.map((c) => (
            <div key={c.id} className="space-y-2 text-sm">
              <p className="font-semibold text-[#b45309]">{c.title}</p>
              <p>{c.description}</p>
              <p>
                {c.left.value} on p. {c.left.source_page} versus {c.right.value} on p. {c.right.source_page}.
              </p>
            </div>
          ))
        )}
      </Section>

      {record.endorsements.length ? (
        <Section title="Endorsements that modify other provisions">
          <ul className="space-y-2 text-sm">
            {record.endorsements.map((e) => (
              <li key={e.id}>
                <span className="font-medium">{e.original_provision}</span> → {e.modifying_endorsement} → {e.resulting_status}{" "}
                <span className="text-xs text-[#1d6fa5]">(p. {e.source_page})</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Potential Coverage Gaps">
        {record.coverage_gaps.length === 0 ? (
          <p className="text-sm text-[#6b7280]">No gap questions were generated from the uploaded pages.</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {record.coverage_gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Questions for Your Agent">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {record.agent_questions.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </Section>

      <Section title="Source References">
        <ul className="space-y-2 text-xs text-[#4a5568]">
          {record.financial_limits.map((f) => (
            <li key={f.id}>
              {f.label} {f.amount} — p. {f.source_page} — “{f.source_text}”
            </li>
          ))}
          {record.exclusions.map((e) => (
            <li key={e.exclusion_id}>
              Exclusion — p. {e.source_page} — “{e.exact_source_excerpt}”
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Educational notes (not policy terms)">
        <ul className="list-disc space-y-1 pl-5 text-sm text-[#4a5568]">
          {record.educational_notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
