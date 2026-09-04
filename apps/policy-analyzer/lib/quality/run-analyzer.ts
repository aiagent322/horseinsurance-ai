import { analyzeDocuments } from "@/lib/analyze";
import { classifyPackage } from "@/lib/classify";
import { hydratePageDiagnostics } from "@/lib/extraction-quality";
import { TEST_ACTOR_A } from "@/lib/persistence/actor-context";
import { MemoryPolicyStore } from "@/lib/persistence/memory-store";
import { analyzerReportBindingError } from "@/lib/persistence/report-binding";
import type { DocumentRecord, PageText, PolicyRecord } from "@/lib/types";
import { decideTerminalState } from "@/lib/worker/outcome";
import type { GroundTruthFixture } from "./schema";

export type ActualRun = {
  scenario_id: string;
  report: PolicyRecord | null;
  job_state: string;
  published: boolean;
  bound: boolean;
  binding_error: string | null;
};

function tinyPdf(tag: string): Buffer {
  return Buffer.from(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n${tag}\n%%EOF\n`);
}

function pageFromFixture(page: GroundTruthFixture["documents"][number]["pages"][number]): PageText {
  const raw: PageText = {
    page: page.page,
    text: page.text,
    extraction_method: page.extraction_method || "NATIVE_TEXT",
    quality_status: page.quality_status,
    character_count: page.character_count
  };
  return hydratePageDiagnostics(raw);
}

export function documentsFromFixture(fixture: GroundTruthFixture, sessionId: string): DocumentRecord[] {
  return fixture.documents.map((doc) => {
    const pages = doc.pages.map(pageFromFixture);
    return {
      document_id: doc.document_id,
      session_id: sessionId,
      original_filename: doc.filename,
      file_type: "application/pdf",
      upload_timestamp: new Date().toISOString(),
      file_hash: `quality-${fixture.package_id}-${doc.document_id}`,
      page_count: pages.length,
      storage_location: "memory",
      extraction_status: doc.extraction_status || "extracted",
      analysis_status: "complete" as const,
      classification: classifyPackage(pages),
      pages
    };
  });
}

function analyzeRun(fixture: GroundTruthFixture): ActualRun {
  const sessionId = `session-${fixture.package_id}`;
  const policyId = `policy-${fixture.package_id}`;
  const documents = documentsFromFixture(fixture, sessionId);
  const report = analyzeDocuments(policyId, sessionId, documents);
  const decision = decideTerminalState(documents, report);
  const binding_error = analyzerReportBindingError(report, {
    policyId,
    sessionId,
    documentCount: documents.length,
    documentIds: documents.map((d) => d.document_id)
  });
  const bound = binding_error === null;
  const publishableDecision = decision === "completed" || decision === "needs_review";
  return {
    scenario_id: "analyze",
    report,
    job_state: decision,
    published: bound && publishableDecision,
    bound,
    binding_error
  };
}

async function cancelledJobRun(): Promise<ActualRun> {
  const store = new MemoryPolicyStore();
  await store.ensureAccount(TEST_ACTOR_A.userId);
  const queued = await store.enqueuePackage(TEST_ACTOR_A, {
    files: [{ filename: "cancelled-edu.pdf", bytes: tinyPdf("quality-cancel") }]
  });
  const claimed = await store.claimJobs("quality-cancel-worker", 1);
  const job = claimed.find((row) => row.policyId === queued.policy_id);
  if (!job) throw new Error("cancelled fixture: job was not claimed");
  const cancelled = await store.cancelJob(TEST_ACTOR_A, queued.policy_id);
  if (!cancelled) throw new Error("cancelled fixture: cancelJob returned false");
  let publishAttempted = false;
  try {
    await store.completeJob(job.jobId, "quality-cancel-worker", {
      policy_id: queued.policy_id,
      session_id: job.sessionId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completeness_status: "APPEARS COMPLETE",
      analysis_status: "complete",
      identification: {},
      documents: [],
      coverages: [],
      exclusions: [],
      financial_limits: [],
      requirements: [],
      endorsements: [],
      conflicts: [],
      form_inventory: [],
      completeness: { status: "APPEARS COMPLETE", warnings: [] },
      agent_questions: [],
      coverage_gaps: [],
      educational_notes: []
    });
    publishAttempted = true;
  } catch {
    publishAttempted = false;
  }
  const report = await store.getReport(TEST_ACTOR_A, queued.policy_id);
  const status = await store.getStatus(TEST_ACTOR_A, queued.policy_id);
  return {
    scenario_id: "cancelled",
    report,
    job_state: status?.status || "cancelled",
    published: Boolean(report) || publishAttempted,
    bound: false,
    binding_error: report ? "unexpected_report_after_cancel" : null
  };
}

async function incompleteJobRun(): Promise<ActualRun> {
  const store = new MemoryPolicyStore();
  await store.ensureAccount(TEST_ACTOR_A.userId);
  const queued = await store.enqueuePackage(TEST_ACTOR_A, {
    files: [{ filename: "incomplete-edu.pdf", bytes: tinyPdf("quality-incomplete") }]
  });
  await store.claimJobs("quality-incomplete-worker", 1);
  const report = await store.getReport(TEST_ACTOR_A, queued.policy_id);
  const status = await store.getStatus(TEST_ACTOR_A, queued.policy_id);
  return {
    scenario_id: "incomplete",
    report,
    job_state: status?.status || "processing",
    published: Boolean(report),
    bound: false,
    binding_error: report ? "unexpected_report_while_processing" : null
  };
}

export async function runFixture(fixture: GroundTruthFixture): Promise<ActualRun[]> {
  if (fixture.job.mode === "cancelled") {
    return [await cancelledJobRun(), await incompleteJobRun()];
  }
  if (fixture.job.mode === "incomplete") {
    return [await incompleteJobRun()];
  }
  return [analyzeRun(fixture)];
}
