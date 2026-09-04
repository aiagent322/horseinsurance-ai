import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ANALYZER_ROOT = path.resolve(here, "../..");
export const REPO_ROOT = path.resolve(ANALYZER_ROOT, "../..");

export function analyzerPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(path.join(ANALYZER_ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return pkg.version || "unknown";
}

export function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export function gitStatusPorcelain(): string {
  try {
    return execFileSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch {
    return "";
  }
}

export function qualityDir(): string {
  return path.join(ANALYZER_ROOT, "quality");
}

export function fixtureDir(): string {
  return path.join(qualityDir(), "fixtures");
}

export function reportsDir(): string {
  return path.join(qualityDir(), "reports");
}

export function thresholdsPath(): string {
  return path.join(qualityDir(), "thresholds.json");
}

export function corpusManifestExists(): boolean {
  return existsSync(path.join(qualityDir(), "corpus.json"));
}
