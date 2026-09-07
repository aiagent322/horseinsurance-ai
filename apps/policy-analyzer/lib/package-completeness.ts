import {
  collectIssuingCompanyNames,
  isUnfilledDeclarationsTemplate
} from "./policy-semantics";
import type { CompletenessResult, PolicyFormRecord, PolicyIdentification } from "./types";

export const COMPLETE_ISSUED_PACKAGE_STATUS = "APPEARS COMPLETE" as const;
export const INCOMPLETE_PACKAGE_STATUS = "DOCUMENT PACKAGE MAY BE INCOMPLETE" as const;
export const SPECIMEN_FORM_SET_STATUS = "COMPLETE CONTRACTUAL SPECIMEN FORM SET" as const;

export const ISSUED_POLICY_FACTS_NOT_ESTABLISHED =
  "Issued policy facts are not established. This contractual specimen does not populate policy number, named insured, policy period, insured horse, scheduled value, or selected optional coverages.";

export function discoveredFormsArePresent(formInventory: Array<Pick<PolicyFormRecord, "status" | "inventory_source">>): boolean {
  return formInventory.some(
    (form) => form.inventory_source === "DISCOVERED_IN_DOCUMENT" && form.status === "PRESENT"
  );
}

export function contractualFormsAreAccountedFor(
  formInventory: Array<Pick<PolicyFormRecord, "status" | "inventory_source">>,
  scheduleFound: boolean
): boolean {
  if (!formInventory.length) return false;
  if (formInventory.some((form) => form.status !== "PRESENT")) return false;
  return scheduleFound || discoveredFormsArePresent(formInventory);
}

export function isContractualSpecimenFormSet(input: {
  pages: Array<{ text: string }>;
  identification: PolicyIdentification;
  formInventory: Array<Pick<PolicyFormRecord, "status" | "form_role" | "inventory_source">>;
  declarationPagesPresent: boolean;
}): boolean {
  if (!input.declarationPagesPresent) return false;
  if (input.identification.policy_number || input.identification.named_insured) return false;
  if (!input.formInventory.length) return false;
  if (input.formInventory.some((form) => form.status !== "PRESENT")) return false;
  if (!input.formInventory.some((form) => /base policy/i.test(form.form_role || ""))) return false;
  const unfilled = input.pages.some((page) => isUnfilledDeclarationsTemplate(page.text));
  const alternativeIssuers = collectIssuingCompanyNames(input.pages).length > 1;
  return unfilled || alternativeIssuers;
}

export function resolvePackageCompleteness(input: {
  documentWarnings: string[];
  issuedFactWarnings: string[];
  declarationPagesPresent: boolean;
  formsAccountedFor: boolean;
  specimenFormSet: boolean;
}): CompletenessResult {
  if (input.documentWarnings.length) {
    return {
      status: INCOMPLETE_PACKAGE_STATUS,
      warnings: [...input.documentWarnings, ...input.issuedFactWarnings]
    };
  }
  if (input.specimenFormSet && input.formsAccountedFor) {
    return {
      status: SPECIMEN_FORM_SET_STATUS,
      warnings: [ISSUED_POLICY_FACTS_NOT_ESTABLISHED]
    };
  }
  if (input.declarationPagesPresent && input.formsAccountedFor && input.issuedFactWarnings.length === 0) {
    return { status: COMPLETE_ISSUED_PACKAGE_STATUS, warnings: [] };
  }
  return {
    status: INCOMPLETE_PACKAGE_STATUS,
    warnings: input.issuedFactWarnings
  };
}
