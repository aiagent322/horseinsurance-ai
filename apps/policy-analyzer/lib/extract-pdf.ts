import { PDFParse } from "pdf-parse";
import type { PageText } from "./types";

export async function extractPdfPages(buf: Buffer): Promise<{
  page_count: number;
  pages: PageText[];
  full_text: string;
}> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const result = await parser.getText();
    const pages: PageText[] = result.pages.map((p) => ({
      page: p.num,
      text: (p.text || "").replace(/\u0000/g, "").trim()
    }));
    return {
      page_count: result.total || pages.length,
      pages,
      full_text: result.text || pages.map((p) => p.text).join("\n\n")
    };
  } finally {
    await parser.destroy();
  }
}
