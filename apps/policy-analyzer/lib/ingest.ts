import { analyzeDocuments } from "@/lib/analyze";
import { classifyPackage } from "@/lib/classify";
import { extractPdfPages } from "@/lib/extract-pdf";
import { deletePolicyStorage, newId, saveOriginal, savePolicy, sha256 } from "@/lib/store";
import type { DocumentRecord } from "@/lib/types";
import {
  assertUploadPackage,
  type IncomingPdf,
  UploadRejectedError
} from "@/lib/validate-upload";

export { isPdfBuffer } from "@/lib/validate-upload";

export async function ingestPolicyPackage(
  files: IncomingPdf[],
  options: { enableOcr?: boolean; ocrTimeoutMs?: number } = {}
): Promise<{ policy_id: string; session_id: string; page_count: number; document_count: number }> {
  assertUploadPackage(files);
  const policyId = newId();
  const sessionId = newId();
  try {
    const documents: DocumentRecord[] = [];
    for (const file of files) {
      const documentId = newId();
      const storage = await saveOriginal(policyId, documentId, file.bytes);
      const extracted = await extractPdfPages(file.bytes, options);
      const doc: DocumentRecord = {
        document_id: documentId,
        session_id: sessionId,
        original_filename: file.filename,
        file_type: "application/pdf",
        upload_timestamp: new Date().toISOString(),
        file_hash: sha256(file.bytes),
        page_count: extracted.page_count,
        storage_location: storage,
        extraction_status: extracted.extraction_status,
        analysis_status: "complete",
        classification: classifyPackage(extracted.pages),
        pages: extracted.pages
      };
      documents.push(doc);
    }
    await savePolicy(analyzeDocuments(policyId, sessionId, documents));
    return {
      policy_id: policyId,
      session_id: sessionId,
      page_count: documents.reduce((n, d) => n + d.page_count, 0),
      document_count: documents.length
    };
  } catch (err) {
    await deletePolicyStorage(policyId);
    throw err;
  }
}

export async function ingestPdfBuffer(
  buf: Buffer,
  filename: string,
  options: { enableOcr?: boolean; ocrTimeoutMs?: number } = {}
): Promise<{ policy_id: string; session_id: string; page_count: number; document_count: number }> {
  return ingestPolicyPackage([{ filename, bytes: buf }], options);
}

export { UploadRejectedError };
