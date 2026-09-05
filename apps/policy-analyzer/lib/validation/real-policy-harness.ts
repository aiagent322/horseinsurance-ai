import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  QUALITY_CORPUS_DIR,
  REAL_POLICY_CATALOG_VERSION,
  realPolicyCatalogSchema,
  realPolicyRecordSchema,
  type RealPolicyRecord
} from "./real-policy-schema";

export type RealPolicyHarnessResult = {
  ok: boolean;
  records: number;
  humanReviewed: number;
  discrepancies: number;
  errors: string[];
};

const FORBIDDEN_SOURCE_FRAGMENTS = [
  QUALITY_CORPUS_DIR,
  "quality/fixtures",
  "customer",
  "private-policy",
  "prod-policy"
];

export function assertAllowedSourcePath(sourcePath: string): void {
  const normalized = sourcePath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("..")) {
    throw new Error("REAL_POLICY_PATH_TRAVERSAL");
  }
  for (const fragment of FORBIDDEN_SOURCE_FRAGMENTS) {
    if (normalized.includes(fragment.toLowerCase())) {
      throw new Error("REAL_POLICY_SOURCE_FORBIDDEN");
    }
  }
}

export function loadRealPolicyCatalog(root: string): { catalogPath: string; recordIds: string[] } {
  const catalogPath = path.join(root, "catalog.json");
  const parsed = realPolicyCatalogSchema.parse(JSON.parse(readFileSync(catalogPath, "utf8")));
  if (parsed.catalog_version !== REAL_POLICY_CATALOG_VERSION) {
    throw new Error("REAL_POLICY_CATALOG_VERSION");
  }
  return { catalogPath, recordIds: parsed.records };
}

export function loadRealPolicyRecord(file: string): RealPolicyRecord {
  const record = realPolicyRecordSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  assertAllowedSourcePath(record.source_path);
  if (!record.human_reviewed) {
    throw new Error(`REAL_POLICY_NOT_HUMAN_REVIEWED:${record.validation_id}`);
  }
  if (record.human_reviewer.toLowerCase().includes("analyzer")) {
    throw new Error(`REAL_POLICY_ANALYZER_CANNOT_AUTHOR_TRUTH:${record.validation_id}`);
  }
  return record;
}

export function compareRealPolicy(record: RealPolicyRecord): string[] {
  const errors: string[] = [];
  if (!record.analyzer_result) return errors;
  if ((record.analyzer_result.job_status === "failed" || record.analyzer_result.job_status === "cancelled") && record.analyzer_result.published) {
    errors.push(`${record.validation_id}: failed or cancelled job published a report`);
  }
  if (record.discrepancy_type !== "none" && record.severity === "none") {
    errors.push(`${record.validation_id}: discrepancy recorded without severity`);
  }
  if (record.discrepancy_type === "none" && record.severity !== "none") {
    errors.push(`${record.validation_id}: severity set without a discrepancy type`);
  }
  return errors;
}

export function runRealPolicyHarness(root: string): RealPolicyHarnessResult {
  const qualityDir = path.resolve(root, "..", "..", QUALITY_CORPUS_DIR);
  if (existsSync(qualityDir) && root.replace(/\\/g, "/").includes("/quality/")) {
    throw new Error("REAL_POLICY_MIXED_WITH_QUALITY_CORPUS");
  }
  const { recordIds } = loadRealPolicyCatalog(root);
  const recordsDir = path.join(root, "records");
  const present = existsSync(recordsDir)
    ? readdirSync(recordsDir).filter((name) => name.endsWith(".json"))
    : [];
  const errors: string[] = [];
  const records: RealPolicyRecord[] = [];
  for (const id of recordIds) {
    const file = path.join(recordsDir, `${id}.json`);
    if (!existsSync(file)) {
      errors.push(`missing record file for ${id}`);
      continue;
    }
    try {
      const record = loadRealPolicyRecord(file);
      records.push(record);
      errors.push(...compareRealPolicy(record));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  for (const extra of present) {
    const id = extra.replace(/\.json$/, "");
    if (!recordIds.includes(id)) {
      errors.push(`record file not listed in catalog: ${id}`);
    }
  }
  return {
    ok: errors.length === 0,
    records: records.length,
    humanReviewed: records.filter((r) => r.human_reviewed).length,
    discrepancies: records.filter((r) => r.discrepancy_type !== "none").length,
    errors
  };
}
