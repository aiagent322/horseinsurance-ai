import { NextResponse } from "next/server";
import { enqueuePolicyPackage } from "@/lib/enqueue";
import { AuthRequiredError, ConfigurationError, analyzerUploadsEnabled } from "@/lib/persistence/config";
import { PRIVATE_HEADERS } from "@/lib/persistence/headers";
import { RateLimitError, BacklogLimitError } from "@/lib/persistence/types";
import { assertSameOrigin } from "@/lib/persistence/same-origin";
import { collectUploadFiles, UploadRejectedError } from "@/lib/validate-upload";

export const runtime = "nodejs";

function userError(code: string): { message: string; status: number; code: string } {
  switch (code) {
    case "NO_FILE":
      return { message: "Upload at least one PDF.", status: 400, code: "choose" };
    case "TOO_MANY_FILES":
      return { message: "Upload at most 10 PDFs in one package.", status: 400, code: "count" };
    case "EMPTY_FILE":
      return { message: "One of the files is empty.", status: 400, code: "empty" };
    case "FILE_TOO_LARGE":
      return { message: "Each PDF must be 20 MB or smaller.", status: 400, code: "size" };
    case "PACKAGE_TOO_LARGE":
      return { message: "The complete package must be 75 MB or smaller.", status: 400, code: "package" };
    case "NOT_PDF":
      return { message: "Only PDF uploads are accepted in this version.", status: 400, code: "type" };
    case "DUPLICATE_FILE":
      return { message: "The package contains duplicate PDFs.", status: 400, code: "duplicate" };
    default:
      return { message: "Could not read one or more PDFs.", status: 422, code: "read" };
  }
}

export async function POST(req: Request) {
  if (!assertSameOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  if (!analyzerUploadsEnabled()) {
    return NextResponse.json(
      { error: "Uploads are not enabled.", code: "uploads_disabled" },
      { status: 503, headers: PRIVATE_HEADERS }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload a PDF file." }, { status: 400, headers: PRIVATE_HEADERS });
  }

  const files = await collectUploadFiles(form);
  if (!files.length) {
    return NextResponse.json({ error: "Upload at least one PDF." }, { status: 400, headers: PRIVATE_HEADERS });
  }

  try {
    const result = await enqueuePolicyPackage(files, {
      submittedUserId: String(form.get("user_id") || form.get("userId") || ""),
      submittedAccountId: String(form.get("account_id") || form.get("accountId") || ""),
      submittedPolicyId: String(form.get("policy_id") || form.get("policyId") || ""),
      submittedStoragePath: String(form.get("storage_path") || "")
    });
    return NextResponse.json(
      {
        policy_id: result.policy_id,
        session_id: result.session_id,
        job_id: result.job_id,
        document_count: result.document_count,
        status: "queued"
      },
      { status: 202, headers: PRIVATE_HEADERS }
    );
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      return NextResponse.json({ error: "Not found" }, { status: 404, headers: PRIVATE_HEADERS });
    }
    if (err instanceof ConfigurationError) {
      return NextResponse.json(
        { error: "Analyzer persistence is not configured." },
        { status: 503, headers: PRIVATE_HEADERS }
      );
    }
    if (err instanceof RateLimitError) {
      return NextResponse.json(
        { error: "Too many analysis requests. Try again shortly." },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    if (err instanceof BacklogLimitError) {
      return NextResponse.json(
        { error: "Analysis backlog is full. Try again shortly." },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(err.retryAfterSeconds) } }
      );
    }
    if (err instanceof UploadRejectedError) {
      const mapped = userError(err.code);
      return NextResponse.json({ error: mapped.message }, { status: mapped.status, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(
      { error: "Could not read one or more PDFs." },
      { status: 422, headers: PRIVATE_HEADERS }
    );
  }
}
