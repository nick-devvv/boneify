// Writes simple text PDFs with pdf-lib. Used to generate the committed demo PDFs and in tests (dev-only dependency).

export async function textToPdf(pages: string[], opts: { title?: string; fontSize?: number } = {}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  if (opts.title) doc.setTitle(opts.title);
  doc.setCreationDate(new Date("2026-11-13T00:00:00Z"));
  doc.setModificationDate(new Date("2026-11-13T00:00:00Z"));
  doc.setProducer("boneify sample generator");
  doc.setCreator("boneify");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = opts.fontSize ?? 10.5;
  const margin = 56;
  const width = 612;
  const height = 792;
  const maxWidth = width - margin * 2;
  const lineHeight = size * 1.45;

  for (const pageText of pages) {
    let page = doc.addPage([width, height]);
    let y = height - margin;
    const newPage = () => { page = doc.addPage([width, height]); y = height - margin; };
    for (const para of pageText.split("\n")) {
      if (!para.trim()) { y -= lineHeight * 0.6; continue; }
      const words = para.split(/\s+/);
      let line = "";
      const flush = () => {
        if (y < margin) newPage();
        page.drawText(line, { x: margin, y, size, font });
        y -= lineHeight;
        line = "";
      };
      for (const w of words) {
        const trial = line ? `${line} ${w}` : w;
        if (font.widthOfTextAtSize(trial, size) > maxWidth && line) { flush(); line = w; } else line = trial;
      }
      if (line) flush();
    }
  }
  return doc.save({ useObjectStreams: false });
}
