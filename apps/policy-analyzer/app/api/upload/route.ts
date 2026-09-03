import { NextResponse } from "next/server";
import { ingestPdfBuffer, isPdfBuffer } from "@/lib/ingest";

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

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) {
    return fail(req, form, "Upload a PDF file.", 400, "choose");
  }
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return fail(req, form, "Only PDF uploads are accepted in this version.", 400, "type");
  }
  if (file.size > 20 * 1024 * 1024) {
    return fail(req, form, "File is larger than 20 MB.", 400, "size");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (!isPdfBuffer(buf)) {
    return fail(req, form, "That file is not a PDF.", 400, "type");
  }

  try {
    const result = await ingestPdfBuffer(buf, file.name);
    if (wantsRedirect(req, form)) {
      return NextResponse.redirect(new URL(`/analysis/${result.policy_id}`, req.url), 303);
    }
    return NextResponse.json(result);
  } catch {
    return fail(req, form, "Could not read text from that PDF.", 422, "read");
  }
}
