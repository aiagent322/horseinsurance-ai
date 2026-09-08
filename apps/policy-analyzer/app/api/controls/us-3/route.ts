import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const FILE_NAME = "us-control-3-great-american-amp-e269955.pdf";
const DOWNLOAD_NAME = "control3_great_american_amp_e269955_issued_package.pdf";

export const runtime = "nodejs";

export async function GET() {
  const filePath = path.join(process.cwd(), "public", "controls", FILE_NAME);
  const bytes = await readFile(filePath);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${DOWNLOAD_NAME}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=3600"
    }
  });
}
