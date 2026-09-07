import {
  isDeclarationsOrScheduleRole,
  segmentLogicalForms
} from "./form-segmentation";
import {
  looksLikeDeclarationsPage,
  policyFormSignalCount
} from "./policy-semantics";
import type { DocumentClass, PageText } from "./types";

export function classifyPackage(pages: PageText[]): DocumentClass {
  const texts = pages.map((page) => page.text || "");
  const hay = texts.join("\n").toLowerCase();
  const joined = texts.join("\n");
  const declarationPages = texts.filter((text) => looksLikeDeclarationsPage(text)).length;
  const formScore = policyFormSignalCount(joined);
  const segments = segmentLogicalForms(pages);
  const uniqueFormIds = new Set(segments.map((seg) => seg.normalized_identifier));
  const mixedLogicalForms =
    uniqueFormIds.size >= 2 && segments.some((seg) => !isDeclarationsOrScheduleRole(seg.role));
  const hasBasePolicySegment = segments.some((seg) => seg.role === "Base Policy Form");

  if (declarationPages > 0) {
    if (mixedLogicalForms) {
      if (hasBasePolicySegment) return "Base Policy Form";
    } else {
      return "Declarations";
    }
  }

  const specificHits: Array<[DocumentClass, number]> = [
    ["Exclusion Endorsement", count(hay, ["exclusion endorsement", "this endorsement excludes"])],
    ["Major Medical Endorsement", count(hay, ["major medical endorsement", "medical limit is amended"])],
    ["Surgical Endorsement", count(hay, ["surgical endorsement", "surgical coverage"])],
    ["Mortality Endorsement", count(hay, ["mortality endorsement"])],
    ["Schedule", count(hay, ["schedule of"])],
    ["Notice", count(hay, ["notice to policyholder"])],
    ["Renewal", count(hay, ["renewal declarations"])],
    ["Amendment", count(hay, ["this amendment"])]
  ];
  specificHits.sort((a, b) => b[1] - a[1]);
  const bestSpecific = specificHits[0];

  if (bestSpecific[1] > 0 && bestSpecific[1] >= formScore) return bestSpecific[0];
  if (formScore >= 2) return "Base Policy Form";
  if (count(hay, ["base policy form", "this policy provides"]) > 0) return "Base Policy Form";
  if (formScore > 0) return "Base Policy Form";
  if (bestSpecific[1] > 0) return bestSpecific[0];
  return "Unknown Document";
}

function count(hay: string, terms: string[]): number {
  return terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
}

export function classifyPage(text: string): DocumentClass {
  return classifyPackage([{ page: 1, text }]);
}
