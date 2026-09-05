#!/usr/bin/env node
/**
 * Mint a disposable local-stack login for human-reviewed staging.
 * Writes email and password to /tmp/fix5-live-stack/human-login (mode 0600).
 * Never prints secrets, tokens, or keys.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = "/tmp/fix5-live-stack/env";
const MARKER = "/tmp/fix5-live-stack/DISPOSABLE_MARKER";
const OUT = "/tmp/fix5-live-stack/human-login";

function loadEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function isLoopback(url) {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

const marker = existsSync(MARKER) ? readFileSync(MARKER, "utf8").trim() : "";
if (marker !== "horseinsurance-fix5-live-stack") {
  console.error("LOCAL_STAGING_STACK_MARKER_MISMATCH");
  process.exit(1);
}

const env = loadEnv(ENV_FILE);
const url = (process.env.LIVE_SUPABASE_URL || env.LIVE_SUPABASE_URL || "").replace(/\/$/, "");
const service = process.env.LIVE_SUPABASE_SERVICE_ROLE_KEY || env.LIVE_SUPABASE_SERVICE_ROLE_KEY || "";
if (!url || !service || !isLoopback(url)) {
  console.error("LOCAL_STAGING_ENV_INCOMPLETE");
  process.exit(1);
}

const email = `local-staging-${randomUUID().slice(0, 8)}@example.test`;
const password = randomBytes(24).toString("base64url") + "Aa1";
const admin = createClient(url, service, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});
const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (created.error || !created.data.user) {
  console.error("LOCAL_STAGING_USER_CREATE_FAILED");
  process.exit(1);
}

writeFileSync(
  OUT,
  [`email=${email}`, `password=${password}`, "Use these only on the disposable local stack.", ""].join("\n"),
  { mode: 0o600 }
);
console.log("LOCAL_LOGIN_WRITTEN");
console.log(OUT);
