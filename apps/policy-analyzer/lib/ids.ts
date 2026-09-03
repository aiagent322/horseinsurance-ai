import { createHash, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
