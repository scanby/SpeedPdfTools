import { pdfjsLib } from './pdfjsSetup';
import { Document, HeadingLevel, Packer, PageBreak, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';
import { PDFDocument, PageSizes, StandardFonts, rgb } from 'pdf-lib';
import { ProgressState, WordConversionSettings } from '../types/speedpdf';
import { sanitizeWinAnsiText, stripExtension, yieldToMain } from './formatters';

interface ExtractedLine {
  y: number;
  text: string;
  avgFontSize: number;
}

export async function pdfToDocx(
  file: File,
  settings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: sourceBytes });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;

  const docParagraphs: Paragraph[] = [];

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / totalPages) * 85) + 5,
        stage: `Extrayendo texto y estructura de página ${pageNum}/${totalPages}...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      type PdfTextItem = Extract<(typeof textContent.items)[number], { str: string }>;
      const rawItems = textContent.items.filter(
        (item): item is PdfTextItem =>
          'str' in item && typeof item.str === 'string' && item.str.trim().length > 0
      );

      // Group items by approximate Y coordinate (top-to-bottom)
      const lines: ExtractedLine[] = [];
      const yTolerance = 4.5;

      for (const item of rawItems) {
        const y = item.transform[5] ?? 0;
        const fontSize = Math.abs(item.transform[0] || item.height || 11);
        let existing = lines.find((l) => Math.abs(l.y - y) <= yTolerance);
        if (!existing) {
          existing = { y, text: item.str, avgFontSize: fontSize };
          lines.push(existing);
        } else {
          existing.text = `${existing.text} ${item.str}`.replace(/\s+/g, ' ').trim();
          existing.avgFontSize = (existing.avgFontSize + fontSize) / 2;
        }
      }

      lines.sort((a, b) => b.y - a.y);

      const sizes = lines.map((l) => l.avgFontSize).sort((a, b) => a - b);
      const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 11;

      if (lines.length === 0) {
        docParagraphs.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[Página ${pageNum} sin texto seleccionable]`,
                italics: true,
                color: '64748B',
              }),
            ],
          })
        );
      } else {
        for (const line of lines) {
          const clean = line.text.trim();
          if (!clean) continue;

          if (line.avgFontSize >= medianSize * 1.45 && clean.length < 110) {
            docParagraphs.push(
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                spacing: { before: 220, after: 120 },
                children: [new TextRun({ text: clean })],
              })
            );
          } else if (line.avgFontSize >= medianSize * 1.18 && clean.length < 130) {
            docParagraphs.push(
              new Paragraph({
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 160, after: 80 },
                children: [new TextRun({ text: clean })],
              })
            );
          } else {
            docParagraphs.push(
              new Paragraph({
                spacing: { after: 100 },
                children: [
                  new TextRun({
                    text: clean,
                    size: settings.fontSize * 2,
                  }),
                ],
              })
            );
          }
        }
      }

      if (settings.preservePageBreaks && pageNum < totalPages) {
        docParagraphs.push(new Paragraph({ children: [new PageBreak()] }));
      }

      page.cleanup();
      await yieldToMain();
    }

    onProgress({
      active: true,
      percent: 94,
      stage: 'Generando archivo Word (.docx) local...',
      currentPage: totalPages,
      totalPages,
    });

    const wordDoc = new Document({
      creator: 'SPEED.PDF',
      title: stripExtension(file.name),
      sections: [
        {
          children: docParagraphs,
        },
      ],
    });

    const blob = await Packer.toBlob(wordDoc);
    onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: totalPages, totalPages });

    return {
      blob,
      fileName: `${stripExtension(file.name)}.docx`,
      pageCount: totalPages,
    };
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

interface TextBlock {
  text: string;
  kind: 'h1' | 'h2' | 'h3' | 'li' | 'p';
}

function extractStructuredBlocks(html: string): TextBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: TextBlock[] = [];

  const elements = doc.body.querySelectorAll('h1, h2, h3, h4, p, li, blockquote');
  elements.forEach((el) => {
    const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!raw) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1') blocks.push({ text: raw, kind: 'h1' });
    else if (tag === 'h2') blocks.push({ text: raw, kind: 'h2' });
    else if (tag === 'h3' || tag === 'h4') blocks.push({ text: raw, kind: 'h3' });
    else if (tag === 'li') blocks.push({ text: `- ${raw}`, kind: 'li' });
    else blocks.push({ text: raw, kind: 'p' });
  });

  if (blocks.length === 0) {
    const fallback = (doc.body.textContent || '').trim();
    if (fallback) {
      fallback.split(/\n+/).forEach((line) => {
        const clean = line.trim();
        if (clean) blocks.push({ text: clean, kind: 'p' });
      });
    }
  }

  return blocks;
}

export async function docxToPdf(
  file: File,
  settings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  onProgress({
    active: true,
    percent: 18,
    stage: 'Analizando estructura del documento Word...',
  });

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const blocks = extractStructuredBlocks(result.value);

  onProgress({
    active: true,
    percent: 45,
    stage: 'Maquetando tipografía y saltos de página PDF...',
  });

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageSize = settings.pageSize === 'letter' ? PageSizes.Letter : PageSizes.A4;
  const [pageW, pageH] = pageSize;
  const margin = 54;
  const maxWidth = pageW - margin * 2;

  let page = pdfDoc.addPage([pageW, pageH]);
  let cursorY = pageH - margin;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight < margin + 16) {
      page = pdfDoc.addPage([pageW, pageH]);
      cursorY = pageH - margin;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isHeading = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3';
    const font = isHeading ? boldFont : regularFont;
    const fontSize =
      block.kind === 'h1'
        ? settings.fontSize + 7
        : block.kind === 'h2'
        ? settings.fontSize + 4
        : block.kind === 'h3'
        ? settings.fontSize + 2
        : settings.fontSize;
    const lineHeight = fontSize * 1.42;

    if (isHeading) {
      cursorY -= 8;
    }

    const safeText = sanitizeWinAnsiText(block.text);
    const words = safeText.split(' ');
    const wrappedLines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        currentLine = candidate;
      } else {
        if (currentLine) wrappedLines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) wrappedLines.push(currentLine);

    for (const line of wrappedLines) {
      ensureSpace(lineHeight);
      page.drawText(line, {
        x: margin,
        y: cursorY,
        size: fontSize,
        font,
        color: isHeading ? rgb(0.06, 0.09, 0.16) : rgb(0.15, 0.19, 0.25),
      });
      cursorY -= lineHeight;
    }

    cursorY -= block.kind === 'li' ? 4 : 9;

    if (i % 15 === 0) {
      onProgress({
        active: true,
        percent: 45 + Math.round((i / Math.max(1, blocks.length)) * 45),
        stage: `Renderizando bloque ${i + 1} de ${blocks.length}...`,
      });
      await yieldToMain();
    }
  }

  const pages = pdfDoc.getPages();
  pages.forEach((p, idx) => {
    const label = `${idx + 1} / ${pages.length}`;
    const width = regularFont.widthOfTextAtSize(label, 9);
    p.drawText(label, {
      x: (pageW - width) / 2,
      y: 26,
      size: 9,
      font: regularFont,
      color: rgb(0.45, 0.5, 0.58),
    });
  });

  pdfDoc.setProducer('SPEED.PDF Local');
  const outBytes = await pdfDoc.save({ useObjectStreams: true });

  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
    currentPage: pages.length,
    totalPages: pages.length,
  });

  return {
    blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
    fileName: `${stripExtension(file.name)}.pdf`,
    pageCount: pages.length,
  };
}
