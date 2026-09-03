export const POLICY_FILES_BUCKET = "policy-files";

export function objectStoragePath(accountId: string, uploadId: string, fileId: string): string {
  return `${accountId}/${uploadId}/${fileId}.pdf`;
}

export function accountIdFromObjectPath(path: string): string | null {
  const accountId = path.split("/")[0];
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId)
    ? accountId
    : null;
}
