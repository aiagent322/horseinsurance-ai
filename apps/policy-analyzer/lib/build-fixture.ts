import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGES: string[][] = [
  [
    "EDUCATIONAL FIXTURE — NOT A REAL INSURANCE POLICY",
    "HorseInsurance.ai Policy Analyzer Test Document",
    "",
    "GREAT PLAINS EQUINE INSURANCE COMPANY",
    "Declarations",
    "",
    "Policy Number: EQ-2026-44119",
    "Named Insured: Jordan Hale",
    "Agency: High Desert Equine Agency",
    "Agent: Sam Rivera",
    "Policy Type: Equine Mortality and Medical",
    "Policy Effective Date: January 1, 2026",
    "Policy Expiration Date: January 1, 2027",
    "Insured Horse Name: Lucky Penny",
    "Registered Name: Lucky Penny Hancock",
    "Breed: Quarter Horse",
    "Age: 8",
    "Sex: Mare",
    "Registration Number: AQHA-4411902",
    "Stated Use: Pleasure and trail",
    "Insured Value / Full Mortality: $45,000",
    "Major Medical Limit: $15,000",
    "Major Medical Deductible: $500",
    "Currency: USD",
    "Forms: EQ-BASE-100, EQ-MED-200, EQ-EXCL-LF, EQ-END-MED"
  ],
  [
    "Base Policy Form EQ-BASE-100",
    "",
    "Full Mortality Coverage",
    "This policy provides Full Mortality coverage for the insured horse in the amount shown on the Declarations. The mortality insured value is $45,000.",
    "",
    "Major Medical Coverage",
    "Subject to the declarations, this policy provides Major Medical coverage with a limit of $15,000 per policy period and a deductible of $500. Reimbursement is 80 percent after the deductible. Diagnostic imaging is subject to a $1,500 sublimit.",
    "",
    "This form does not provide Loss of Use coverage.",
    "This form does not provide Stallion Infertility coverage."
  ],
  [
    "Exclusion Endorsement EQ-EXCL-LF",
    "",
    "This endorsement excludes coverage for the left front fetlock, including any injury, lameness, or treatment arising from the left front fetlock.",
    "This is a named anatomical exclusion. Do not expand this exclusion to other limbs.",
    "Pre-existing condition: prior left front fetlock inflammation as disclosed on the application."
  ],
  [
    "Major Medical Endorsement EQ-END-MED",
    "",
    "This endorsement modifies and replaces the Major Medical limit stated on the Declarations.",
    "The Major Medical limit is amended to $10,000 per policy period.",
    "Surgical coverage is added with a $10,000 occurrence limit.",
    "Colic Surgery is covered subject to the surgical limit.",
    "",
    "Emergency Requirements",
    "In the event of colic, serious illness, injury, surgery, possible euthanasia, death, or theft, the Named Insured must:",
    "- Notify the carrier or agent within 24 hours.",
    "- Obtain veterinary certification before elective euthanasia except when a veterinarian certifies that delay would cause inhumane suffering.",
    "- Preserve remains if death occurs, pending carrier examination.",
    "- File written documentation within 30 days.",
    "",
    "Notwithstanding the Declarations, this endorsement supersedes the medical limit."
  ]
];

export async function buildFixturePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (const lines of PAGES) {
    const page = doc.addPage([612, 792]);
    let y = 740;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const f = i === 0 || /^(Declarations|Base Policy|Exclusion|Major Medical Endorsement|GREAT PLAINS|Emergency)/.test(line) ? bold : font;
      const size = i === 0 ? 11 : 11;
      const wrapped = wrapLine(line, 92);
      for (const w of wrapped) {
        page.drawText(w, { x: 56, y, size, font: f, color: rgb(0.08, 0.08, 0.1) });
        y -= 16;
      }
      y -= 6;
    }
  }
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

function wrapLine(text: string, width: number): string[] {
  if (!text) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}
