import { analyzeDocuments } from "@/lib/analyze";
import { classifyPackage } from "@/lib/classify";
import { extractPdfPages } from "@/lib/extract-pdf";
import { newId, saveOriginal, savePolicy, sha256 } from "@/lib/store";
import type { DocumentRecord } from "@/lib/types";

export async function ingestPdfBuffer(
  buf: Buffer,
  filename: string
): Promise<{ policy_id: string; page_count: number }> {
  const policyId = newId();
  const documentId = newId();
  const sessionId = newId();
  const pages = await extractPdfPages(buf);
  const storage = await saveOriginal(policyId, documentId, buf);
  const doc: DocumentRecord = {
    document_id: documentId,
    session_id: sessionId,
    original_filename: filename,
    file_type: "application/pdf",
    upload_timestamp: new Date().toISOString(),
    file_hash: sha256(buf),
    page_count: pages.page_count,
    storage_location: storage,
    extraction_status: "extracted",
    analysis_status: "complete",
    classification: classifyPackage(pages.pages),
    pages: pages.pages
  };
  await savePolicy(analyzeDocuments(policyId, sessionId, [doc]));
  return { policy_id: policyId, page_count: pages.page_count };
}

export function isPdfBuffer(buf: Buffer): boolean {
  return buf.slice(0, 5).toString() === "%PDF-";
}
