import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PolicyRecord } from "./types";

const ROOT = path.join(process.cwd(), "data");
const UPLOADS = path.join(ROOT, "uploads");
const POLICIES = path.join(ROOT, "policies");

export function newId(): string {
  return randomUUID();
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export async function ensureStore(): Promise<void> {
  await mkdir(UPLOADS, { recursive: true });
  await mkdir(POLICIES, { recursive: true });
}

export function originalPath(policyId: string, documentId: string, ext = ".pdf"): string {
  return path.join(UPLOADS, policyId, `${documentId}${ext}`);
}

export async function saveOriginal(
  policyId: string,
  documentId: string,
  buf: Buffer,
  ext = ".pdf"
): Promise<string> {
  const dir = path.join(UPLOADS, policyId);
  await mkdir(dir, { recursive: true });
  const loc = originalPath(policyId, documentId, ext);
  await writeFile(loc, buf);
  return loc;
}

export async function savePolicy(record: PolicyRecord): Promise<void> {
  await ensureStore();
  await writeFile(
    path.join(POLICIES, `${record.policy_id}.json`),
    JSON.stringify(record, null, 2)
  );
}

export async function loadPolicy(policyId: string): Promise<PolicyRecord | null> {
  try {
    const raw = await readFile(path.join(POLICIES, `${policyId}.json`), "utf8");
    return JSON.parse(raw) as PolicyRecord;
  } catch {
    return null;
  }
}

export async function deletePolicyStorage(policyId: string): Promise<void> {
  await rm(path.join(POLICIES, `${policyId}.json`), { force: true });
  await rm(path.join(UPLOADS, policyId), { recursive: true, force: true });
}

export async function deletePolicy(policyId: string): Promise<boolean> {
  const rec = await loadPolicy(policyId);
  await deletePolicyStorage(policyId);
  return Boolean(rec);
}

export async function readOriginal(policyId: string, documentId: string): Promise<Buffer | null> {
  try {
    return await readFile(originalPath(policyId, documentId));
  } catch {
    return null;
  }
}
