import { PDFDocument, StandardFonts } from "pdf-lib";

export async function buildTextPdf(lines: string[], filenameIgnored?: string): Promise<Buffer> {
  void filenameIgnored;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([612, 792]);
  let y = 740;
  for (const line of lines) {
    page.drawText(line.slice(0, 110), { x: 48, y, size: 12, font });
    y -= 16;
  }
  return Buffer.from(await doc.save());
}
