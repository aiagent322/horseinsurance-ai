import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { assertServiceRoleModuleAllowed } from "../lib/persistence/service-role-boundary";

const ROOT = process.cwd();

const FORBIDDEN = new Set([
  path.join(ROOT, "lib/persistence/service-client.ts"),
  path.join(ROOT, "lib/persistence/service-role-boundary.ts"),
  path.join(ROOT, "lib/persistence/worker-store.ts"),
  path.join(ROOT, "lib/persistence/worker-factory.ts"),
  path.join(ROOT, "lib/persistence/admin-client.ts"),
  path.join(ROOT, "lib/deploy/ops-probes.ts")
]);

function walkFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      walkFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function isClientModule(source: string): boolean {
  const head = source.split("\n").slice(0, 5).join("\n");
  return /^\s*["']use client["']\s*;?\s*$/m.test(head);
}

function importsOf(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /from\s+["']([^"']+)["']/g,
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.push(match[1]);
    }
  }
  return found;
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (spec.startsWith("node:") || (!spec.startsWith(".") && !spec.startsWith("@/"))) return null;
  const base = spec.startsWith("@/")
    ? path.join(ROOT, spec.slice(2))
    : path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx")
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function clientEntryPoints(): string[] {
  const files = [
    ...walkFiles(path.join(ROOT, "app")),
    ...walkFiles(path.join(ROOT, "components")),
    ...walkFiles(path.join(ROOT, "lib"))
  ];
  return files.filter((file) => isClientModule(readFileSync(file, "utf8")));
}

function reachableForbiddenFrom(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [entry];
  const hits: string[] = [];
  while (stack.length) {
    const current = stack.pop();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    if (FORBIDDEN.has(current) && current !== entry) {
      hits.push(`${path.relative(ROOT, entry)} -> ${path.relative(ROOT, current)}`);
      continue;
    }
    if (FORBIDDEN.has(current) && current === entry) {
      hits.push(path.relative(ROOT, current));
      continue;
    }
    const source = readFileSync(current, "utf8");
    for (const spec of importsOf(source)) {
      const resolved = resolveImport(current, spec);
      if (resolved) stack.push(resolved);
    }
  }
  return hits;
}

function walkDirNames(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDirNames(full, acc);
    else acc.push(full);
  }
  return acc;
}

function main(): void {
  assertServiceRoleModuleAllowed();

  const factory = readFileSync(path.join(ROOT, "lib/persistence/factory.ts"), "utf8");
  assert.equal(/service-client|worker-store|createServiceRoleClient/.test(factory), false);
  assert.equal(/server-only/.test(readFileSync(path.join(ROOT, "lib/persistence/service-client.ts"), "utf8")), false);

  const publicServiceRole = Object.keys(process.env).filter(
    (key) => key.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE/i.test(key)
  );
  assert.deepEqual(publicServiceRole, []);

  const sourceHits: string[] = [];
  for (const file of walkFiles(ROOT)) {
    if (file.includes("/scripts/")) continue;
    const source = readFileSync(file, "utf8");
    if (/NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(source)) {
      sourceHits.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(sourceHits, []);

  const graphHits = clientEntryPoints().flatMap(reachableForbiddenFrom);
  assert.deepEqual(graphHits, []);

  const staticDir = path.join(ROOT, ".next/static");
  if (existsSync(staticDir)) {
    const forbiddenClient = /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY|service-role-boundary/;
    const leaked: string[] = [];
    for (const file of walkDirNames(staticDir)) {
      if (!/\.(js|css|json)$/.test(file)) continue;
      const source = readFileSync(file, "utf8");
      if (forbiddenClient.test(source)) leaked.push(path.relative(ROOT, file));
      if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(source) && /service_role/i.test(source)) {
        leaked.push(path.relative(ROOT, file));
      }
    }
    assert.deepEqual(leaked, []);
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && serviceKey.length > 8 && existsSync(path.join(ROOT, ".next"))) {
    const leakedValue: string[] = [];
    for (const file of walkDirNames(path.join(ROOT, ".next"))) {
      if (!/\.(js|json|html|txt)$/.test(file)) continue;
      if (file.includes("cache/webpack") || file.includes("cache/eslint")) continue;
      const source = readFileSync(file, "utf8");
      if (source.includes(serviceKey)) leakedValue.push(path.relative(ROOT, file));
    }
    assert.deepEqual(leakedValue, []);
  }

  console.log("SERVICE BOUNDARY OK");
}

main();
