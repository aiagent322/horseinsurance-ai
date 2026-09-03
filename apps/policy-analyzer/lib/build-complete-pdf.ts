import { PDFDocument, StandardFonts } from "pdf-lib";

const COMPLETE_PAGES = [
  [
    "Declarations",
    "Policy Number: EQ-COMP-1",
    "Named Insured: Ada Cole",
    "Forms: EQ-A-1, EQ-B-1, EQ-C-1"
  ],
  ["Base Policy Form EQ-A-1", "This policy provides Full Mortality coverage for the insured horse."],
  ["Exclusion Endorsement EQ-B-1", "This endorsement excludes coverage for the left front fetlock."],
  [
    "Endorsement EQ-C-1",
    "This endorsement modifies and replaces the Major Medical limit stated on the Declarations."
  ]
];

export async function buildCompletePolicyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (const lines of COMPLETE_PAGES) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (const line of lines) {
      page.drawText(line.slice(0, 110), { x: 48, y, size: 12, font });
      y -= 18;
    }
  }
  return Buffer.from(await doc.save());
}

export async function buildCompletePolicyPages(): Promise<Buffer[]> {
  const files: Buffer[] = [];
  for (const lines of COMPLETE_PAGES) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (const line of lines) {
      page.drawText(line.slice(0, 110), { x: 48, y, size: 12, font });
      y -= 18;
    }
    files.push(Buffer.from(await doc.save()));
  }
  return files;
}

export async function buildPartialPolicyPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const good = doc.addPage([612, 792]);
  good.drawText("Declarations", { x: 48, y: 740, size: 12, font });
  good.drawText("Policy Number: EQ-PART-1", { x: 48, y: 720, size: 12, font });
  good.drawText("Named Insured: Ada Cole", { x: 48, y: 700, size: 12, font });
  good.drawText("Forms: EQ-A-1, EQ-B-1", { x: 48, y: 680, size: 12, font });
  const weak = doc.addPage([612, 792]);
  weak.drawText(".", { x: 48, y: 740, size: 8, font });
  return Buffer.from(await doc.save());
}
