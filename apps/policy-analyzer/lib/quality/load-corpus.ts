import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  assertSupportedCoverages,
  CORPUS_VERSION,
  MIN_FIXTURE_COUNT,
  groundTruthFixtureSchema,
  qualityThresholdsSchema,
  type GroundTruthFixture,
  type QualityThresholds
} from "./schema";
import { fixtureDir, thresholdsPath } from "./git-meta";

export function loadThresholds(overridePath?: string): QualityThresholds {
  const raw = JSON.parse(readFileSync(overridePath || thresholdsPath(), "utf8")) as unknown;
  return qualityThresholdsSchema.parse(raw);
}

export function loadFixtureFile(filePath: string): GroundTruthFixture {
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const fixture = groundTruthFixtureSchema.parse(raw);
  if (fixture.corpus_version !== CORPUS_VERSION) {
    throw new Error(`${filePath}: corpus_version ${fixture.corpus_version} != ${CORPUS_VERSION}`);
  }
  assertSupportedCoverages(fixture);
  return fixture;
}

export function loadCorpus(dir = fixtureDir()): GroundTruthFixture[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
  if (files.length < MIN_FIXTURE_COUNT) {
    throw new Error(`Expected at least ${MIN_FIXTURE_COUNT} fixture files, found ${files.length} in ${dir}`);
  }
  return files.map((name) => loadFixtureFile(path.join(dir, name)));
}
