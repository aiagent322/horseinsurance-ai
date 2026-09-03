import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

export const SCANNED_PDF_PHRASE = "EQUINE MEDICAL COVERAGE";

export async function buildScannedPdf(phrase = SCANNED_PDF_PHRASE): Promise<Buffer> {
  const width = 1700;
  const height = 2200;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = "bold 88px sans-serif";
  ctx.fillText(phrase, 80, 320);
  ctx.font = "bold 64px sans-serif";
  ctx.fillText("SCANNED PAGE ONE", 80, 460);
  const png = canvas.toBuffer("image/png");

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const image = await pdf.embedPng(png);
  page.drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  return Buffer.from(await pdf.save());
}
