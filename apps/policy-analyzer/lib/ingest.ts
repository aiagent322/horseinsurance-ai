import { analyzeDocuments } from "@/lib/analyze";
import { getUserStore } from "@/lib/auth/session";
import { classifyPackage } from "@/lib/classify";
import { extractPdfPages } from "@/lib/extract-pdf";
import { newId, sha256 } from "@/lib/ids";
import { AuthRequiredError } from "@/lib/persistence/config";
import { getPolicyStore } from "@/lib/persistence/factory";
import type { Actor, PolicyStore } from "@/lib/persistence/types";
import type { DocumentRecord } from "@/lib/types";
import {
  assertUploadPackage,
  type IncomingPdf,
  UploadRejectedError
} from "@/lib/validate-upload";

export { isPdfBuffer } from "@/lib/validate-upload";

export async function ingestPolicyPackage(
  files: IncomingPdf[],
  options: {
    enableOcr?: boolean;
    ocrTimeoutMs?: number;
    actor?: Actor;
    store?: PolicyStore;
    source?: "upload" | "fixture";
    submittedUserId?: string;
    submittedAccountId?: string;
    submittedPolicyId?: string;
    submittedStoragePath?: string;
  } = {}
): Promise<{ policy_id: string; session_id: string; page_count: number; document_count: number }> {
  assertUploadPackage(files);
  const resolved =
    options.actor && options.store
      ? { actor: options.actor, store: options.store }
      : options.actor
        ? { actor: options.actor, store: options.store ?? getPolicyStore() }
        : await getUserStore();
  if (!resolved.actor) throw new AuthRequiredError();
  const store = resolved.store;
  const actor = resolved.actor;

  const policyId = newId();
  const sessionId = newId();
  const documents: DocumentRecord[] = [];
  try {
    for (const file of files) {
      const documentId = newId();
      const extracted = await extractPdfPages(file.bytes, options);
      documents.push({
        document_id: documentId,
        session_id: sessionId,
        original_filename: file.filename,
        file_type: "application/pdf",
        upload_timestamp: new Date().toISOString(),
        file_hash: sha256(file.bytes),
        page_count: extracted.page_count,
        storage_location: "",
        extraction_status: extracted.extraction_status,
        analysis_status: "complete",
        classification: classifyPackage(extracted.pages),
        pages: extracted.pages
      });
    }
    const report = analyzeDocuments(policyId, sessionId, documents);
    const saved = await store.savePackage(actor, {
      files,
      report,
      source: options.source ?? "upload",
      submittedUserId: options.submittedUserId,
      submittedAccountId: options.submittedAccountId,
      submittedPolicyId: options.submittedPolicyId,
      submittedStoragePath: options.submittedStoragePath
    });
    return {
      policy_id: saved.policy_id,
      session_id: saved.session_id,
      page_count: saved.page_count,
      document_count: saved.document_count
    };
  } catch (err) {
    throw err;
  }
}

export async function ingestPdfBuffer(
  buf: Buffer,
  filename: string,
  options: Parameters<typeof ingestPolicyPackage>[1] = {}
): Promise<{ policy_id: string; session_id: string; page_count: number; document_count: number }> {
  return ingestPolicyPackage([{ filename, bytes: buf }], options);
}

export { UploadRejectedError };
