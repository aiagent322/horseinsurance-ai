import { UUID_RE } from "@/lib/original-document";
import type { ReservationResult, ReservedFileTuple } from "./types";

const STORAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function parseReservationResult(raw: unknown, expectedFileCount: number): ReservationResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("reservation_malformed");
  }
  const value = raw as Record<string, unknown>;
  for (const key of ["reservation_id", "upload_id", "analysis_id", "policy_id", "session_id", "job_id"] as const) {
    if (!isUuid(value[key])) {
      throw new Error("reservation_malformed");
    }
  }
  if (
    typeof value.file_count !== "number" ||
    !Number.isInteger(value.file_count) ||
    value.file_count !== expectedFileCount ||
    value.file_count < 1
  ) {
    throw new Error("reservation_malformed");
  }
  if (!Array.isArray(value.files) || value.files.length !== value.file_count) {
    throw new Error("reservation_malformed");
  }
  if (typeof value.expires_at !== "string" || Number.isNaN(Date.parse(value.expires_at))) {
    throw new Error("reservation_malformed");
  }

  const files: ReservedFileTuple[] = [];
  const fileIds = new Set<string>();
  const documentIds = new Set<string>();
  const paths = new Set<string>();
  const ordinals = new Set<number>();

  for (const item of value.files) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("reservation_malformed");
    }
    const file = item as Record<string, unknown>;
    if (
      typeof file.ordinal !== "number" ||
      !Number.isInteger(file.ordinal) ||
      file.ordinal < 1 ||
      file.ordinal > value.file_count ||
      ordinals.has(file.ordinal)
    ) {
      throw new Error("reservation_malformed");
    }
    if (!isUuid(file.file_id) || !isUuid(file.document_id) || typeof file.storage_path !== "string") {
      throw new Error("reservation_malformed");
    }
    if (!STORAGE_PATH_RE.test(file.storage_path)) {
      throw new Error("reservation_malformed");
    }
    const [accountId, uploadId, fileName] = file.storage_path.split("/");
    const fileIdFromPath = fileName.replace(/\.pdf$/i, "");
    if (uploadId !== value.upload_id || fileIdFromPath !== file.file_id) {
      throw new Error("reservation_malformed");
    }
    void accountId;
    if (fileIds.has(file.file_id) || documentIds.has(file.document_id) || paths.has(file.storage_path)) {
      throw new Error("reservation_malformed");
    }
    ordinals.add(file.ordinal);
    fileIds.add(file.file_id);
    documentIds.add(file.document_id);
    paths.add(file.storage_path);
    files.push({
      ordinal: file.ordinal,
      file_id: file.file_id,
      document_id: file.document_id,
      storage_path: file.storage_path
    });
  }

  files.sort((a, b) => a.ordinal - b.ordinal);
  for (let i = 0; i < files.length; i += 1) {
    if (files[i].ordinal !== i + 1) {
      throw new Error("reservation_malformed");
    }
  }

  return {
    reservation_id: value.reservation_id as string,
    upload_id: value.upload_id as string,
    analysis_id: value.analysis_id as string,
    policy_id: value.policy_id as string,
    session_id: value.session_id as string,
    job_id: value.job_id as string,
    file_count: value.file_count,
    files,
    expires_at: value.expires_at
  };
}
