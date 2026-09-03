import { NextResponse } from "next/server";
import { buildFixturePdf } from "@/lib/build-fixture";

export const runtime = "nodejs";

export async function GET() {
  const buf = await buildFixturePdf();
  return new NextResponse(Uint8Array.from(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=horseinsurance-educational-fixture.pdf",
      "Cache-Control": "no-store"
    }
  });
}
