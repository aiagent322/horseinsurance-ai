import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DELETE_ANALYSIS_ACTION_LABEL,
  ORIGINAL_PDF_ACTION_LABEL,
  describeReportActionControls,
  visibleReportActionLabels
} from "../lib/report-actions";

const here = dirname(fileURLToPath(import.meta.url));
const reportViewSource = readFileSync(join(here, "../components/report-view.tsx"), "utf8");
const accountBarSource = readFileSync(join(here, "../components/account-bar.tsx"), "utf8");
const layoutSource = readFileSync(join(here, "../app/layout.tsx"), "utf8");
const originalRouteSource = readFileSync(join(here, "../app/api/policies/[id]/original/route.ts"), "utf8");
const helperSource = readFileSync(join(here, "../lib/report-actions.ts"), "utf8");

function reportHeaderSource(): string {
  const start = reportViewSource.indexOf("describeReportActionControls");
  const inventory = reportViewSource.indexOf("Policy Document Inventory");
  assert.ok(start >= 0 && inventory > start, "report header region must be locatable");
  return reportViewSource.slice(start, inventory);
}

function main() {
  const policyId = "11111111-2222-3333-4444-555555555555";
  const header = reportHeaderSource();

  const single = describeReportActionControls({ policyId, documentCount: 1 });
  assert.equal(single.showOriginalPdfShortcut, true);
  assert.equal(single.originalPdfHref, `/api/policies/${policyId}/original`);
  assert.equal(single.originalPdfAccessibleName, ORIGINAL_PDF_ACTION_LABEL);
  assert.equal(single.originalPdfAccessibleName, "View original PDF");
  assert.equal(single.showDeleteAnalysis, true);
  assert.equal(single.deleteAnalysisLabel, DELETE_ANALYSIS_ACTION_LABEL);
  assert.equal(single.deleteAnalysisLabel, "Delete analysis");
  assert.equal(single.showReportSignOut, false);
  assert.deepEqual(visibleReportActionLabels(single), ["View original PDF", "Delete analysis"]);
  console.log("TEST A OK — single document: View original PDF + Delete analysis; no report Sign out");

  const multi = describeReportActionControls({ policyId, documentCount: 3 });
  assert.equal(multi.showOriginalPdfShortcut, false);
  assert.equal(multi.originalPdfHref, null);
  assert.equal(multi.originalPdfAccessibleName, null);
  assert.equal(multi.showDeleteAnalysis, true);
  assert.equal(multi.showReportSignOut, false);
  assert.deepEqual(visibleReportActionLabels(multi), ["Delete analysis"]);
  assert.match(reportViewSource, /Original file/, "per-document original links remain in inventory");
  assert.match(
    reportViewSource,
    /\/api\/policies\/\$\{record\.policy_id\}\/documents\/\$\{d\.document_id\}\/original/,
    "inventory original links stay per-document"
  );
  console.log("TEST B OK — multiple documents: top original shortcut omitted; inventory originals remain");

  assert.match(reportViewSource, /describeReportActionControls/);
  assert.match(reportViewSource, /method: "DELETE"/);
  assert.match(reportViewSource, /\/api\/policies\/\$\{record\.policy_id\}/);
  assert.match(reportViewSource, /Delete this analysis and the uploaded PDF/);
  assert.match(header, /onDelete/);
  assert.match(originalRouteSource, /documents\[0\]/, "package original endpoint still serves the first file");
  console.log("TEST C OK — Delete analysis remains wired to the existing DELETE route");

  assert.match(layoutSource, /AccountBar/);
  assert.match(accountBarSource, /\/auth\/sign-out/);
  assert.match(accountBarSource, />\s*Sign out\s*</);
  assert.doesNotMatch(header, /Sign out/);
  assert.doesNotMatch(header, /\/auth\/sign-out/);
  assert.doesNotMatch(reportViewSource, /\/auth\/sign-out/);
  assert.doesNotMatch(reportViewSource, />\s*Sign out\s*</);
  assert.doesNotMatch(reportViewSource, /First original PDF/);
  assert.doesNotMatch(helperSource, /First original PDF/);
  console.log("TEST D OK — Sign out stays in the global header; report duplicate removed");

  assert.match(header, /flex flex-wrap items-start justify-between gap-3/);
  assert.match(header, /flex flex-wrap items-center justify-end gap-2/);
  assert.match(header, /min-w-0/);
  assert.doesNotMatch(header, /hidden\s+(?:md|lg|sm):/);
  assert.doesNotMatch(header, /md:hidden|lg:hidden|sm:hidden/);
  console.log("TEST E OK — action row wraps; no hidden responsive duplicate Sign out");

  assert.equal(ORIGINAL_PDF_ACTION_LABEL, "View original PDF");
  assert.match(reportViewSource, /originalPdfAccessibleName/);
  assert.match(reportViewSource, /target="_blank"/);
  assert.match(reportViewSource, /rel="noreferrer"/);
  assert.doesNotMatch(header, /aria-label=""/);
  assert.doesNotMatch(helperSource, /Diamond State|AEM 200|Mortality_Policy/i);
  assert.doesNotMatch(header, /Diamond State|AEM 200|Mortality_Policy/i);
  console.log("ACCESSIBLE LABELS OK — View original PDF; no carrier/filename branching");

  console.log("REPORT ACTIONS REGRESSION OK");
}

main();
