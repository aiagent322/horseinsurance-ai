import { createHash } from "node:crypto";

export const MAX_PDF_FILES = 10;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 75 * 1024 * 1024;
export const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

export type IncomingPdf = {
  filename: string;
  bytes: Buffer;
};

export type UploadValidationError = {
  code:
    | "NO_FILE"
    | "TOO_MANY_FILES"
    | "EMPTY_FILE"
    | "FILE_TOO_LARGE"
    | "PACKAGE_TOO_LARGE"
    | "NOT_PDF"
    | "DUPLICATE_FILE";
  message: string;
};

export class UploadRejectedError extends Error {
  readonly code: UploadValidationError["code"];
  constructor(error: UploadValidationError) {
    super(error.message);
    this.name = "UploadRejectedError";
    this.code = error.code;
  }
}

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hasPdfMagic(bytes: Buffer): boolean {
  if (bytes.length < 5) return false;
  if (bytes.subarray(0, 5).equals(PDF_MAGIC)) return true;
  const head = bytes.subarray(0, Math.min(bytes.length, 1024));
  return head.indexOf(PDF_MAGIC) === 0;
}

export function isPdfBuffer(buf: Buffer): boolean {
  return hasPdfMagic(buf);
}

export function validateUploadPackage(files: IncomingPdf[]): UploadValidationError | null {
  if (files.length === 0) {
    return { code: "NO_FILE", message: "Upload at least one PDF." };
  }
  if (files.length > MAX_PDF_FILES) {
    return { code: "TOO_MANY_FILES", message: `Upload at most ${MAX_PDF_FILES} PDFs in one package.` };
  }

  let total = 0;
  const hashes = new Set<string>();
  for (const file of files) {
    if (!file.bytes.length) {
      return { code: "EMPTY_FILE", message: "One of the files is empty." };
    }
    if (file.bytes.length > MAX_FILE_BYTES) {
      return { code: "FILE_TOO_LARGE", message: "Each PDF must be 20 MB or smaller." };
    }
    if (!hasPdfMagic(file.bytes)) {
      return { code: "NOT_PDF", message: "Only PDF uploads are accepted in this version." };
    }
    total += file.bytes.length;
    const hash = sha256Buffer(file.bytes);
    if (hashes.has(hash)) {
      return { code: "DUPLICATE_FILE", message: "The package contains duplicate PDFs." };
    }
    hashes.add(hash);
  }
  if (total > MAX_PACKAGE_BYTES) {
    return { code: "PACKAGE_TOO_LARGE", message: "The complete package must be 75 MB or smaller." };
  }
  return null;
}

export function assertUploadPackage(files: IncomingPdf[]): void {
  const error = validateUploadPackage(files);
  if (error) throw new UploadRejectedError(error);
}

export async function collectUploadFiles(form: FormData): Promise<IncomingPdf[]> {
  const files: File[] = [];
  for (const value of form.getAll("files")) {
    if (value instanceof File && value.size > 0) files.push(value);
  }
  const legacy = form.get("file");
  if (legacy instanceof File && legacy.size > 0) files.push(legacy);

  const out: IncomingPdf[] = [];
  for (const file of files) {
    out.push({
      filename: file.name || "upload.pdf",
      bytes: Buffer.from(await file.arrayBuffer())
    });
  }
  return out;
}
