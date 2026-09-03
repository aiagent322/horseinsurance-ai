import { NextResponse } from "next/server";
import { ingestPolicyPackage, UploadRejectedError } from "@/lib/ingest";
import { collectUploadFiles } from "@/lib/validate-upload";

export const runtime = "nodejs";

function wantsRedirect(req: Request, form: FormData): boolean {
  if (form.get("redirect") === "1") return true;
  const accept = req.headers.get("accept") || "";
  return accept.includes("text/html") && !accept.includes("application/json");
}

function fail(req: Request, form: FormData, error: string, status: number, code: string) {
  if (wantsRedirect(req, form)) {
    const url = new URL("/", req.url);
    url.searchParams.set("error", code);
    return NextResponse.redirect(url, 303);
  }
  return NextResponse.json({ error }, { status });
}

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
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Upload a PDF file." }, { status: 400 });
  }

  const files = await collectUploadFiles(form);
  if (!files.length) {
    return fail(req, form, "Upload at least one PDF.", 400, "choose");
  }

  try {
    const result = await ingestPolicyPackage(files);
    if (wantsRedirect(req, form)) {
      return NextResponse.redirect(new URL(`/analysis/${result.policy_id}`, req.url), 303);
    }
    return NextResponse.json({
      policy_id: result.policy_id,
      session_id: result.session_id,
      document_count: result.document_count,
      page_count: result.page_count
    });
  } catch (err) {
    if (err instanceof UploadRejectedError) {
      const mapped = userError(err.code);
      return fail(req, form, mapped.message, mapped.status, mapped.code);
    }
    return fail(req, form, "Could not read one or more PDFs.", 422, "read");
  }
}
