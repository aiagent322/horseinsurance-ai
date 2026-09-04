import type {
  CoverageRecord,
  DocumentRecord,
  PolicyFormRecord,
  PolicyIdentification,
  PolicyRecord
} from "@/lib/types";
import { SUPPORTED_COVERAGES, type GroundTruthFixture } from "./schema";
import { documentsFromFixture, type ActualRun } from "./run-analyzer";

function identificationFrom(fixture: GroundTruthFixture): PolicyIdentification {
  const d = fixture.expected.declarations;
  const firstDoc = fixture.documents[0]?.document_id || "";
  const sourced = (value: string | null | undefined) =>
    value
      ? {
          value,
          source_document_id: firstDoc,
          source_page: 1,
          source_text: value,
          confidence_status: "HIGH" as const
        }
      : undefined;
  return {
    named_insured: sourced(d.named_insured),
    policy_number: sourced(d.policy_number),
    carrier_name: sourced(d.carrier_name),
    insured_horse_name: sourced(d.insured_horse_name),
    insured_value: sourced(d.insured_value)
  };
}

function coveragesFrom(fixture: GroundTruthFixture, policyId: string): CoverageRecord[] {
  return SUPPORTED_COVERAGES.map((type) => {
    const expected = fixture.expected.coverages[type];
    return {
      coverage_id: `syn-${fixture.package_id}-${type}`,
      policy_id: policyId,
      coverage_type: type,
      coverage_status: expected.status,
      description: `${type} ${expected.status}`,
      source_document_id: expected.citation?.document_id || "",
      source_page: expected.citation?.page || 0,
      source_text: expected.status === "NOT FOUND" ? "" : `${type} source excerpt`,
      confidence_status: "HIGH" as const,
      coverage_limit: expected.limit
        ? {
            value: expected.limit,
            source_document_id: expected.citation?.document_id || "",
            source_page: expected.citation?.page || 0,
            source_text: expected.limit,
            confidence_status: "HIGH" as const
          }
        : undefined,
      deductible: expected.deductible
        ? {
            value: expected.deductible,
            source_document_id: expected.citation?.document_id || "",
            source_page: expected.citation?.page || 0,
            source_text: expected.deductible,
            confidence_status: "HIGH" as const
          }
        : undefined
    };
  });
}

function formsFrom(fixture: GroundTruthFixture): PolicyFormRecord[] {
  const listing = fixture.documents[0]?.document_id || "";
  return fixture.expected.forms.map((form, index) => ({
    id: `syn-form-${index}`,
    printed_identifier: form.printed_identifier,
    normalized_identifier: form.printed_identifier.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    edition: form.edition,
    listing_document_id: listing,
    listing_page: 1,
    listing_source_text: form.printed_identifier,
    status: form.status,
    match_document_id: form.status === "MISSING" ? undefined : fixture.documents[1]?.document_id || listing,
    match_page: form.status === "MISSING" ? undefined : 2,
    match_source_text: form.status === "MISSING" ? undefined : `Form ${form.printed_identifier}`,
    match_edition: form.status === "EDITION MISMATCH" ? "01/2099" : form.edition
  }));
}

export function syntheticMatchingActual(fixture: GroundTruthFixture): ActualRun {
  const sessionId = `session-${fixture.package_id}`;
  const policyId = `policy-${fixture.package_id}`;
  const documents: DocumentRecord[] =
    fixture.job.mode === "analyze" ? documentsFromFixture(fixture, sessionId) : [];
  const report: PolicyRecord = {
    policy_id: policyId,
    session_id: sessionId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    completeness_status: fixture.expected.completeness,
    analysis_status: "complete",
    identification: identificationFrom(fixture),
    documents,
    coverages: coveragesFrom(fixture, policyId),
    exclusions: fixture.expected.exclusions.map((excl, i) => ({
      exclusion_id: `syn-ex-${i}`,
      policy_id: policyId,
      exclusion_type: "Named anatomical / condition exclusion",
      condition: excl.condition_contains,
      description: excl.condition_contains,
      source_document_id: excl.citation.document_id,
      source_page: excl.citation.page,
      exact_source_excerpt: excl.condition_contains,
      confidence_status: "HIGH" as const
    })),
    financial_limits: fixture.expected.limits.map((limit, i) => ({
      id: `syn-lim-${i}`,
      label: limit.label_contains,
      amount: limit.amount,
      source_document_id: limit.citation.document_id,
      source_page: limit.citation.page,
      source_text: limit.amount
    })),
    requirements: fixture.expected.requirements.map((req, i) => ({
      id: `syn-req-${i}`,
      trigger: "colic",
      requirement: req.requirement_contains,
      source_document_id: req.citation.document_id,
      source_page: req.citation.page,
      source_text: req.requirement_contains
    })),
    endorsements: [],
    conflicts: fixture.expected.conflicts.map((c, i) => ({
      id: `syn-cf-${i}`,
      title: "Potential Policy Conflict",
      description: c.description_contains || c.kind,
      left: { label: "left", value: "1", source_page: 1, source_text: "left" },
      right: { label: "right", value: "2", source_page: 2, source_text: "right" }
    })),
    form_inventory: formsFrom(fixture),
    completeness: { status: fixture.expected.completeness, warnings: [] },
    agent_questions: [],
    coverage_gaps: [],
    educational_notes: []
  };

  const publishable = fixture.job.publishable;
  return {
    scenario_id: fixture.job.mode === "analyze" ? "analyze" : fixture.job.mode,
    report: fixture.evaluation_scope === "job" ? null : report,
    job_state: fixture.job.expected_state,
    published: publishable,
    bound: publishable,
    binding_error: publishable ? null : null
  };
}

export function cloneActual(actual: ActualRun): ActualRun {
  return structuredClone(actual);
}
