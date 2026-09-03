import type { DocumentClass, PageText } from "./types";

export function classifyPackage(pages: PageText[]): DocumentClass {
  const hay = pages.map((p) => p.text).join("\n").toLowerCase();
  const hits: Array<[DocumentClass, number]> = [
    ["Declarations", count(hay, ["declarations", "named insured", "policy number"])],
    ["Exclusion Endorsement", count(hay, ["exclusion endorsement", "this endorsement excludes"])],
    ["Major Medical Endorsement", count(hay, ["major medical endorsement", "medical limit is amended"])],
    ["Surgical Endorsement", count(hay, ["surgical endorsement", "surgical coverage"])],
    ["Mortality Endorsement", count(hay, ["mortality endorsement"])],
    ["Base Policy Form", count(hay, ["base policy form", "this policy provides"])],
    ["Schedule", count(hay, ["schedule of"])],
    ["Notice", count(hay, ["notice to policyholder"])],
    ["Renewal", count(hay, ["renewal declarations"])],
    ["Amendment", count(hay, ["this amendment"])]
  ];
  hits.sort((a, b) => b[1] - a[1]);
  return hits[0][1] > 0 ? hits[0][0] : "Unknown Document";
}

function count(hay: string, terms: string[]): number {
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
}

export function classifyPage(text: string): DocumentClass {
  return classifyPackage([{ page: 1, text }]);
}
