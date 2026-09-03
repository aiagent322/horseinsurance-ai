import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ConfigurationError } from "../lib/persistence/config";
import { createPolicyStore, resetMemoryStoreForTests } from "../lib/persistence/factory";
import { MemoryPolicyStore } from "../lib/persistence/memory-store";
import { objectStoragePath } from "../lib/persistence/object-paths";
import { TEST_ACTOR_A, TEST_ACTOR_B } from "../lib/persistence/actor-context";
import { sampleFiles, sampleReport } from "./test-fixtures";

async function main() {
  const previousStore = process.env.POLICY_ANALYZER_STORE;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.POLICY_ANALYZER_STORE;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  assert.throws(
    () => createPolicyStore(),
    (error: unknown) => error instanceof ConfigurationError,
    "1: production store fails closed without Supabase"
  );
  process.env.POLICY_ANALYZER_STORE = "memory";
  if (previousUrl) process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousKey) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;

  const store = resetMemoryStoreForTests();
  const report = sampleReport();
  const files = sampleFiles(report, "persist");
  files[0].bytes = Buffer.from("%PDF-memory-not-fs\n%%EOF\n");
  report.documents[0].file_hash = "hash-a";
  const saved = await store.savePackage(TEST_ACTOR_A, { files, report });
  assert.equal(saved.policy_id, report.policy_id);
  const dataDir = path.join(process.cwd(), "data");
  if (existsSync(dataDir)) {
    const policies = existsSync(path.join(dataDir, "policies")) ? readdirSync(path.join(dataDir, "policies")) : [];
    assert.ok(!policies.some((name) => name.includes(saved.policy_id)), "2: memory store does not write filesystem JSON");
  }
  const loaded = await store.getReport(TEST_ACTOR_A, saved.policy_id);
  assert.ok(loaded, "3: user A can read user A analysis");
  assert.equal(loaded?.documents[0].document_id, report.documents[0].document_id);

  const denied = await store.getReport(TEST_ACTOR_B, saved.policy_id);
  assert.equal(denied, null, "4: user B cannot read user A analysis");
  assert.equal(await store.getOriginal(TEST_ACTOR_B, saved.policy_id, report.documents[0].document_id), null);
  assert.equal(await store.deletePackage(TEST_ACTOR_B, saved.policy_id), "not_found");

  const original = await store.getOriginal(TEST_ACTOR_A, saved.policy_id, report.documents[0].document_id);
  assert.ok(original, "9: original retrieval confirms policy/document ownership");
  const storedPath = store.objectPathFor(saved.policy_id, report.documents[0].document_id);
  assert.ok(storedPath);
  assert.equal(
    storedPath,
    objectStoragePath(TEST_ACTOR_A.accountId, saved.upload_id, storedPath.split("/")[2].replace(/\.pdf$/, ""))
  );
  assert.match(storedPath, new RegExp(`^${TEST_ACTOR_A.accountId}/`));
  assert.ok(!storedPath.includes("policy.pdf"), "8: submitted filename is not the object path");

  const submitted = sampleReport();
  const submittedSave = await store.savePackage(TEST_ACTOR_A, {
    files: sampleFiles(submitted, "submitted"),
    report: submitted,
    submittedUserId: TEST_ACTOR_B.userId,
    submittedAccountId: TEST_ACTOR_B.accountId,
    submittedPolicyId: saved.policy_id,
    submittedStoragePath: `${TEST_ACTOR_B.accountId}/evil/path.pdf`
  });
  assert.notEqual(submittedSave.policy_id, saved.policy_id, "6: submitted policy id is ignored as an overwrite");
  assert.equal(await store.getReport(TEST_ACTOR_B, submittedSave.policy_id), null, "6: submitted account id is ignored");
  assert.match(
    store.objectPathFor(submittedSave.policy_id, submitted.documents[0].document_id) || "",
    new RegExp(`^${TEST_ACTOR_A.accountId}/`)
  );

  const reportB = sampleReport();
  await store.savePackage(TEST_ACTOR_B, { files: sampleFiles(reportB, "b"), report: reportB });
  assert.equal(
    await store.getOriginal(TEST_ACTOR_B, reportB.policy_id, report.documents[0].document_id),
    null,
    "7: cross-tenant document ids cannot be attached"
  );
  assert.equal(await store.getOriginal(TEST_ACTOR_A, reportB.policy_id, report.documents[0].document_id), null);

  const failDb = new MemoryPolicyStore();
  const failReport = sampleReport();
  failDb.failAfterObjectUpload = true;
  await assert.rejects(() => failDb.savePackage(TEST_ACTOR_A, { files: sampleFiles(failReport, "dbfail"), report: failReport }));
  assert.equal(failDb.rows.size, 0, "10: database failure leaves no report");
  assert.equal(failDb.backend.objects.size, 0, "10: uploaded objects are cleaned up");

  const failStorage = new MemoryPolicyStore();
  failStorage.backend.failNextUpload = true;
  const storageReport = sampleReport();
  await assert.rejects(() =>
    failStorage.savePackage(TEST_ACTOR_A, { files: sampleFiles(storageReport, "storagefail"), report: storageReport })
  );
  assert.equal(failStorage.rows.size, 0, "11: storage failure leaves no report records");
  assert.equal(failStorage.backend.objects.size, 0);

  const failPartial = new MemoryPolicyStore();
  failPartial.persistPartialThenFail = true;
  const partialReport = sampleReport();
  await assert.rejects(() =>
    failPartial.savePackage(TEST_ACTOR_A, { files: sampleFiles(partialReport, "partial"), report: partialReport })
  );
  assert.equal(failPartial.rows.size, 0, "12: multi-table persist failure leaves no partial report");
  assert.equal(failPartial.backend.objects.size, 0);

  if (previousStore) process.env.POLICY_ANALYZER_STORE = previousStore;
  console.log("PERSISTENCE OK");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
