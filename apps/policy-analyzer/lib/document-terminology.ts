import { looksLikeDeclarationsPage } from "./policy-semantics";
import type { CompletenessResult, DocumentRecord, PolicyFormRecord, PolicyRecord } from "./types";

export type DocumentPackageState = {
  declarationsPresent: boolean;
  declarationsMissingWarning: boolean;
  schedulePresent: boolean;
  listedForms: PolicyFormRecord[];
  unmatchedListedForms: PolicyFormRecord[];
  uploadedEndorsementDocuments: DocumentRecord[];
  packageIncomplete: boolean;
};

export type FormsEndorsementsPresentation = {
  heading: string;
  summary: string;
  listedMissingNote: string;
};

type PackageFacts = Pick<PolicyRecord, "documents" | "form_inventory" | "completeness">;

function isEndorsementClassification(classification: string): boolean {
  return /endorsement/i.test(classification);
}

function pageLooksLikeDeclarations(doc: DocumentRecord): boolean {
  return (doc.pages || []).some((page) => looksLikeDeclarationsPage(page.text || ""));
}

export function inspectDocumentPackageState(record: PackageFacts): DocumentPackageState {
  const documents = record.documents || [];
  const listedForms = record.form_inventory || [];
  const warnings = record.completeness?.warnings || [];
  return {
    declarationsPresent:
      documents.some((doc) => doc.classification === "Declarations") || documents.some(pageLooksLikeDeclarations),
    declarationsMissingWarning: warnings.some((warning) => /no page was classified as declarations/i.test(warning)),
    schedulePresent: documents.some((doc) => doc.classification === "Schedule"),
    listedForms,
    unmatchedListedForms: listedForms.filter((form) => form.status === "MISSING" || form.status === "EDITION MISMATCH"),
    uploadedEndorsementDocuments: documents.filter((doc) => isEndorsementClassification(doc.classification)),
    packageIncomplete: record.completeness?.status === "DOCUMENT PACKAGE MAY BE INCOMPLETE"
  };
}

function endorsementCountPhrase(count: number): string {
  return count === 1 ? "1 endorsement was uploaded." : `${count} endorsements were uploaded.`;
}

function missingPackageVerification(state: DocumentPackageState): string {
  if (state.schedulePresent) {
    return "The Declarations were not provided, so the analyzer cannot determine whether this is the complete set of issued forms.";
  }
  return "The uploaded package does not include the Declarations/Schedule, so additional forms or endorsements that may be part of the issued policy cannot be verified from the documents provided.";
}

function noDeclarationsSummary(state: DocumentPackageState): string {
  const parts: string[] = [];
  if (state.uploadedEndorsementDocuments.length) {
    parts.push(endorsementCountPhrase(state.uploadedEndorsementDocuments.length));
  }
  if (state.schedulePresent) {
    parts.push("A Schedule was uploaded.");
  }
  parts.push(missingPackageVerification(state));
  return parts.join(" ");
}

function isDiscoveredForm(form: PolicyFormRecord): boolean {
  return form.inventory_source === "DISCOVERED_IN_DOCUMENT";
}

export function describeFormsAndEndorsements(record: PackageFacts): FormsEndorsementsPresentation {
  const state = inspectDocumentPackageState(record);
  const declarationsAnalyzed = state.declarationsPresent && !state.declarationsMissingWarning;
  const listedOnDeclarations = state.listedForms.filter((form) => !isDiscoveredForm(form));
  const discoveredForms = state.listedForms.filter(isDiscoveredForm);

  if (listedOnDeclarations.length > 0 && declarationsAnalyzed) {
    return {
      heading: "Forms / Endorsements Listed on the Declarations",
      summary:
        "The uploaded Declarations list the following forms and endorsements. A listed identifier is not treated as uploaded unless matching form text was found in the package.",
      listedMissingNote:
        "Listed on the uploaded Declarations, but no separately sourced form text was found in the uploaded package. A listed form number is not proof the form was uploaded."
    };
  }

  if (discoveredForms.length > 0) {
    const endorsementCount = discoveredForms.filter((form) =>
      /endorsement|optional coverage/i.test(form.form_role || "")
    ).length;
    const parts = [
      discoveredForms.length === 1
        ? "1 distinct contractual form was identified inside the uploaded document."
        : `${discoveredForms.length} distinct contractual forms were identified inside the uploaded document.`
    ];
    if (endorsementCount) {
      parts.push(
        endorsementCount === 1
          ? "1 of those forms is an endorsement or optional coverage form."
          : `${endorsementCount} of those forms are endorsements or optional coverage forms.`
      );
    }
    return {
      heading: "Forms & Endorsements",
      summary: parts.join(" "),
      listedMissingNote:
        "A listed form number is not proof the form was uploaded unless matching form text was found in the package."
    };
  }

  if (declarationsAnalyzed) {
    const parts = ["No forms or endorsements were identified on the uploaded Declarations."];
    if (state.uploadedEndorsementDocuments.length) {
      parts.push(endorsementCountPhrase(state.uploadedEndorsementDocuments.length));
    }
    return {
      heading: "Forms & Endorsements",
      summary: parts.join(" "),
      listedMissingNote:
        "A listed form number is not proof the form was uploaded unless matching form text was found in the package."
    };
  }

  return {
    heading: "Forms & Endorsements",
    summary: noDeclarationsSummary(state),
    listedMissingNote:
      "A listed form number is not proof the form was uploaded unless matching form text was found in the package."
  };
}

export function formsSectionContradictsPackageWarning(
  completeness: CompletenessResult,
  presentation: FormsEndorsementsPresentation
): boolean {
  const declarationsMissing = completeness.warnings.some((warning) =>
    /no page was classified as declarations/i.test(warning)
  );
  if (!declarationsMissing) return false;
  const copy = `${presentation.heading}\n${presentation.summary}\n${presentation.listedMissingNote}`;
  return (
    /forms listed on the declarations/i.test(copy) ||
    /identified on the uploaded declarations/i.test(copy) ||
    /number appears on the declarations/i.test(copy) ||
    /the uploaded declarations list/i.test(copy)
  );
}
