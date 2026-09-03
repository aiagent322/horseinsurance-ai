import { getUserStore } from "@/lib/auth/session";
import { AuthRequiredError } from "@/lib/persistence/config";
import { getPolicyStore } from "@/lib/persistence/factory";
import type { Actor, EnqueuePackageResult, PolicyStore } from "@/lib/persistence/types";
import { assertUploadPackage, type IncomingPdf } from "@/lib/validate-upload";

export async function enqueuePolicyPackage(
  files: IncomingPdf[],
  options: {
    actor?: Actor;
    store?: PolicyStore;
    source?: "upload" | "fixture";
    submittedUserId?: string;
    submittedAccountId?: string;
    submittedPolicyId?: string;
    submittedStoragePath?: string;
  } = {}
): Promise<EnqueuePackageResult> {
  assertUploadPackage(files);
  const resolved =
    options.actor && options.store
      ? { actor: options.actor, store: options.store }
      : options.actor
        ? { actor: options.actor, store: options.store ?? getPolicyStore() }
        : await getUserStore();
  if (!resolved.actor) throw new AuthRequiredError();
  return resolved.store.enqueuePackage(resolved.actor, {
    files,
    source: options.source ?? "upload",
    submittedUserId: options.submittedUserId,
    submittedAccountId: options.submittedAccountId,
    submittedPolicyId: options.submittedPolicyId,
    submittedStoragePath: options.submittedStoragePath
  });
}
