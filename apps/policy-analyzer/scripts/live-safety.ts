/**
 * Live-database safety gate.
 *
 * Protects the repository and disposable test database. Decisions are
 * derived from explicit inputs so regressions can run without touching
 * real git branches or remote services.
 */

export const ACCEPTED_FIX6_SHA = "60d3de8d952cdd059c26d333876f8557dbf6cb4d";
export const REQUIRED_REMOTE = "aiagent322/horseinsurance-ai";
export const DISPOSABLE_STACK_MARKER = "horseinsurance-fix5-live-stack";
export const DISPOSABLE_DATABASE_NAME = "postgres";
export const REQUIRED_STACK_CONTAINERS = ["fix5-pg", "fix5-rest", "fix5-auth", "fix5-storage"] as const;

const SHA_RE = /^[0-9a-f]{40}$/i;
const BLOCKED_BRANCHES = new Set(["main", "master"]);
const CANONICAL_PATH = "aiagent322/horseinsurance-ai";

export type LiveSafetyInput = {
  remotes?: string[] | null;
  branch?: string | null;
  head?: string | null;
  descendsFromFix6?: boolean | null;
  supabaseUrl?: string | null;
  restUrl?: string | null;
  authUrl?: string | null;
  storageUrl?: string | null;
  databaseName?: string | null;
  disposableMarker?: string | null;
  containerNames?: string[] | null;
};

export type LiveSafetyDecision = {
  ok: boolean;
  code: string;
  reason: string;
};

function reject(code: string, reason: string): LiveSafetyDecision {
  return { ok: false, code, reason };
}

function accept(reason: string): LiveSafetyDecision {
  return { ok: true, code: "accepted", reason };
}

export function isLoopbackHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1";
  } catch {
    return false;
  }
}

export function isRemoteSupabaseUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.endsWith(".supabase.co") || host.endsWith(".supabase.net") || host === "supabase.co";
  } catch {
    return false;
  }
}

function pathIsCanonicalRepo(pathname: string): boolean {
  const stripped = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!stripped || stripped.includes("\\") || stripped.includes("..")) return false;
  const withoutGit = stripped.toLowerCase().endsWith(".git") ? stripped.slice(0, -4) : stripped;
  return withoutGit === CANONICAL_PATH;
}

/**
 * Accept only exact canonical GitHub remotes for aiagent322/horseinsurance-ai.
 * Rejects suffix/prefix hosts, extra path segments, credentials, and lookalikes.
 */
export function isCanonicalHorseinsuranceRemote(remote: string): boolean {
  const trimmed = remote.trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes("\0")) return false;

  const scp = /^git@github\.com:([^:\s]+)$/;
  const scpMatch = trimmed.match(scp);
  if (scpMatch) return pathIsCanonicalRepo(scpMatch[1]);

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.password) return false;
  if (parsed.search || parsed.hash) return false;
  if (parsed.hostname.toLowerCase() !== "github.com") return false;

  if (parsed.protocol === "https:") {
    if (parsed.username) return false;
    if (parsed.port && parsed.port !== "443") return false;
    return pathIsCanonicalRepo(parsed.pathname);
  }

  if (parsed.protocol === "ssh:") {
    if (parsed.username && parsed.username !== "git") return false;
    if (parsed.port && parsed.port !== "22") return false;
    return pathIsCanonicalRepo(parsed.pathname);
  }

  return false;
}

export function remoteResolvesToCanonicalRepo(remotes: string[]): boolean {
  return remotes.some((remote) => isCanonicalHorseinsuranceRemote(remote));
}

export function evaluateRepositorySafety(input: LiveSafetyInput): LiveSafetyDecision {
  if (
    input.remotes == null ||
    input.head == null ||
    input.descendsFromFix6 == null ||
    input.branch == null
  ) {
    return reject("missing_input", "Repository safety input is incomplete.");
  }
  if (!input.remotes.length || !input.head.trim()) {
    return reject("missing_input", "Repository remote or HEAD is missing.");
  }
  if (!remoteResolvesToCanonicalRepo(input.remotes)) {
    return reject("wrong_repository", "Remote does not resolve to aiagent322/horseinsurance-ai.");
  }
  if (!SHA_RE.test(input.head)) {
    return reject("invalid_head", "HEAD is not a full commit SHA.");
  }
  const branch = input.branch.trim();
  if (BLOCKED_BRANCHES.has(branch.toLowerCase())) {
    return reject("protected_branch", "Live destructive tests cannot run on main or master.");
  }
  if (!input.descendsFromFix6) {
    return reject("ancestry", "HEAD does not descend from the accepted Fix #6 SHA.");
  }
  if (!branch) {
    return accept("Detached HEAD is a verified descendant of the accepted Fix #6 SHA.");
  }
  return accept("Named branch is a verified descendant of the accepted Fix #6 SHA.");
}

export function evaluateTargetSafety(input: LiveSafetyInput): LiveSafetyDecision {
  const urls = [input.supabaseUrl, input.restUrl, input.authUrl, input.storageUrl];
  if (urls.some((url) => url == null) || input.databaseName == null || input.disposableMarker == null || input.containerNames == null) {
    return reject("missing_input", "Target safety input is incomplete.");
  }
  for (const url of urls) {
    if (!url || !url.trim()) return reject("missing_input", "A required local endpoint URL is missing.");
    if (isRemoteSupabaseUrl(url)) return reject("remote_supabase", "Remote Supabase URLs are rejected.");
    if (!isLoopbackHttpUrl(url)) return reject("non_loopback", "REST, Auth, Storage, and API URLs must be loopback.");
  }
  if (input.databaseName !== DISPOSABLE_DATABASE_NAME) {
    return reject("unknown_database", "Database name is not the disposable test database.");
  }
  if (input.disposableMarker !== DISPOSABLE_STACK_MARKER) {
    return reject("missing_marker", "Disposable test-stack marker is missing or does not match.");
  }
  const names = new Set(input.containerNames);
  for (const required of REQUIRED_STACK_CONTAINERS) {
    if (!names.has(required)) {
      return reject("unknown_stack", "Required disposable stack containers are missing.");
    }
  }
  return accept("Local disposable loopback stack identified.");
}

export function evaluateCleanupScope(accountIds: string[] | null | undefined): LiveSafetyDecision {
  if (!accountIds) return reject("missing_input", "Cleanup account scope is missing.");
  if (!accountIds.length) return reject("cleanup_scope", "Cleanup refused without isolated test account IDs.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (accountIds.some((id) => !uuid.test(id))) {
    return reject("cleanup_scope", "Cleanup is limited to isolated test account UUIDs created by this run.");
  }
  return accept("Cleanup is limited to isolated test accounts created by this run.");
}

export function evaluateLiveSafety(input: LiveSafetyInput): LiveSafetyDecision {
  const repo = evaluateRepositorySafety(input);
  if (!repo.ok) return repo;
  const target = evaluateTargetSafety(input);
  if (!target.ok) return target;
  return accept("Repository and disposable local stack passed the live safety gate.");
}
