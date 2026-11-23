import {
  AlignmentType,
  Document,
  HeadingLevel,
  ISectionOptions,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  TabStopType,
  TextRun,
} from 'docx';
import mammoth from 'mammoth';
import { PDFDocument, PDFFont, PageSizes, StandardFonts, rgb } from 'pdf-lib';
import { ProgressState, WordConversionSettings } from '../types/speedpdf';
import { getDesktopBridge } from './desktopBridge';
import { sanitizeWinAnsiText, stripExtension, yieldToMain } from './formatters';
import { computeClampedRenderViewport, renderPageToCanvas } from './pdfEngine';
import { formatPdfOpenError, openPdfDocument } from './pdfjsSetup';

interface ExtractedSpan {
  x: number;
  width: number;
  text: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

interface ExtractedLine {
  y: number;
  minX: number;
  maxX: number;
  avgFontSize: number;
  spans: ExtractedSpan[];
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality = 0.94): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error('No se pudo generar la vista de página para Word.'));
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/jpeg',
      quality
    );
  });
}

function detectFontStyle(
  fontName: string,
  fontFamily?: string
): { bold: boolean; italic: boolean } {
  const combined = `${fontName} ${fontFamily || ''}`;
  const bold = /bold|black|heavy|semibold|demi|700|800|900/i.test(combined);
  const italic = /italic|oblique|slant/i.test(combined);
  return { bold, italic };
}

function buildLineRuns(line: ExtractedLine, baseBodyPt: number, isHeading = false): TextRun[] {
  const sorted = [...line.spans].sort((a, b) => a.x - b.x);
  const runs: TextRun[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const span = sorted[i];
    let prefix = '';

    if (i > 0) {
      const prev = sorted[i - 1];
      const prevEnd = prev.x + Math.max(0, prev.width);
      const gap = span.x - prevEnd;
      const spaceThreshold = Math.max(1.8, span.fontSize * 0.22);
      const tabThreshold = Math.max(18, span.fontSize * 1.45);
      if (gap >= tabThreshold) {
        prefix = '\t';
      } else if (gap >= spaceThreshold && !prev.text.endsWith(' ') && !span.text.startsWith(' ')) {
        prefix = ' ';
      }
    }

    const runText = `${prefix}${span.text}`;
    if (!runText) continue;

    if (isHeading) {
      runs.push(
        new TextRun({
          text: runText,
          bold: true,
          italics: span.italic,
        })
      );
    } else {
      const computedHalfPts = Math.max(16, Math.min(56, Math.round(span.fontSize * 2)));
      const targetSize =
        Math.abs(span.fontSize - baseBodyPt) <= 2.2 ? baseBodyPt * 2 : computedHalfPts;
      runs.push(
        new TextRun({
          text: runText,
          bold: span.bold,
          italics: span.italic,
          size: targetSize,
        })
      );
    }
  }

  return runs;
}

export async function pdfToDocx(
  file: File,
  settings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = openPdfDocument(sourceBytes);
  let pdf: Awaited<ReturnType<typeof openPdfDocument>['promise']>;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    throw formatPdfOpenError(err, file.name);
  }
  const totalPages = pdf.numPages;
  const fidelityMode = settings.fidelityMode ?? 'editable';

  try {
    if (fidelityMode === 'visual') {
      const sections: ISectionOptions[] = [];

      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        onProgress({
          active: true,
          percent: Math.round(((pageNum - 1) / Math.max(1, totalPages)) * 85) + 5,
          stage: `Renderizando diseño exacto de página ${pageNum}/${totalPages}...`,
          currentPage: pageNum,
          totalPages,
        });

        const page = await pdf.getPage(pageNum);
        const { baseViewport, renderViewport } = computeClampedRenderViewport(page, 210, 0);
        const canvas = await renderPageToCanvas(page, renderViewport, false);
        let jpegBytes: Uint8Array;
        try {
          jpegBytes = await canvasToJpegBytes(canvas, 0.94);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
          page.cleanup();
        }

        const widthTwips = Math.max(1440, Math.round(baseViewport.width * 20));
        const heightTwips = Math.max(1440, Math.round(baseViewport.height * 20));
        const widthPx = Math.max(100, Math.round(baseViewport.width * (96 / 72)));
        const heightPx = Math.max(100, Math.round(baseViewport.height * (96 / 72)));

        sections.push({
          properties: {
            page: {
              size: {
                width: widthTwips,
                height: heightTwips,
              },
              margin: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
              },
            },
          },
          children: [
            new Paragraph({
              spacing: { before: 0, after: 0, line: 240 },
              children: [
                new ImageRun({
                  type: 'jpg',
                  data: jpegBytes,
                  transformation: {
                    width: widthPx,
                    height: heightPx,
                  },
                }),
              ],
            }),
          ],
        });

        await yieldToMain();
      }

      onProgress({
        active: true,
        percent: 95,
        stage: 'Empaquetando documento Word (.docx) de fidelidad 1:1...',
        currentPage: totalPages,
        totalPages,
      });

      const wordDoc = new Document({
        creator: 'SPEED.PDF',
        title: stripExtension(file.name),
        sections,
      });

      const blob = await Packer.toBlob(wordDoc);
      onProgress({
        active: false,
        percent: 100,
        stage: 'Completado',
        currentPage: totalPages,
        totalPages,
      });

      return {
        blob,
        fileName: `${stripExtension(file.name)}_a_word.docx`,
        pageCount: totalPages,
      };
    }

    // Modo editable mejorado (con estilo tipográfico, tabuladores de columnas y respaldo visual para escaneos)
    const docParagraphs: Paragraph[] = [];
    const defaultPageWTwips = settings.pageSize === 'letter' ? 12240 : 11906;
    const defaultPageHTwips = settings.pageSize === 'letter' ? 15840 : 16838;
    const marginTwips = 1134; // ~2 cm

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / Math.max(1, totalPages)) * 85) + 5,
        stage: `Extrayendo texto, estilos y estructura de página ${pageNum}/${totalPages}...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const textContent = await page.getTextContent();
      const stylesMap = (textContent.styles || {}) as Record<string, { fontFamily?: string }>;

      type PdfTextItem = Extract<(typeof textContent.items)[number], { str: string }>;
      const rawItems = textContent.items.filter(
        (item): item is PdfTextItem =>
          'str' in item && typeof item.str === 'string' && item.str.trim().length > 0
      );

      if (rawItems.length < 3) {
        // Página escaneada o puramente gráfica: incrustar captura nítida a 200 DPI
        const { renderViewport } = computeClampedRenderViewport(page, 200, 0);
        const canvas = await renderPageToCanvas(page, renderViewport, false);
        let jpegBytes: Uint8Array;
        try {
          jpegBytes = await canvasToJpegBytes(canvas, 0.93);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }

        const contentWidthPx = Math.round(((defaultPageWTwips - marginTwips * 2) / 1440) * 96);
        const maxHeightPx = Math.round(((defaultPageHTwips - marginTwips * 2) / 1440) * 96);
        const ratio = Math.min(
          contentWidthPx / Math.max(1, baseViewport.width),
          maxHeightPx / Math.max(1, baseViewport.height)
        );
        docParagraphs.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new ImageRun({
                type: 'jpg',
                data: jpegBytes,
                transformation: {
                  width: Math.max(80, Math.round(baseViewport.width * ratio)),
                  height: Math.max(80, Math.round(baseViewport.height * ratio)),
                },
              }),
            ],
          })
        );
      } else {
        const lines: ExtractedLine[] = [];

        for (const item of rawItems) {
          const x = item.transform[4] ?? 0;
          const y = item.transform[5] ?? 0;
          const fontSize = Math.max(
            6,
            Math.hypot(item.transform[0] ?? 0, item.transform[1] ?? 0) || item.height || 11
          );
          const spanWidth = Math.max(0, item.width || 0);
          const styleInfo = stylesMap[item.fontName];
          const { bold, italic } = detectFontStyle(item.fontName || '', styleInfo?.fontFamily);
          const yTol = Math.max(2.8, fontSize * 0.36);

          let existing = lines.find((l) => Math.abs(l.y - y) <= yTol);
          const span: ExtractedSpan = {
            x,
            width: spanWidth,
            text: item.str,
            fontSize,
            bold,
            italic,
          };

          if (!existing) {
            lines.push({
              y,
              minX: x,
              maxX: x + spanWidth,
              avgFontSize: fontSize,
              spans: [span],
            });
          } else {
            existing.spans.push(span);
            existing.minX = Math.min(existing.minX, x);
            existing.maxX = Math.max(existing.maxX, x + spanWidth);
            existing.avgFontSize =
              existing.spans.reduce((sum, s) => sum + s.fontSize, 0) / existing.spans.length;
          }
        }

        lines.sort((a, b) => b.y - a.y);

        const sizes = lines.map((l) => l.avgFontSize).sort((a, b) => a - b);
        const medianSize = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : 11;
        const pageW = Math.max(200, baseViewport.width);

        // Agrupar líneas normales continuas en párrafos coherentes
        let i = 0;
        while (i < lines.length) {
          const line = lines[i];
          const runs = buildLineRuns(line, settings.fontSize, false);
          const plainLineText = line.spans
            .slice()
            .sort((a, b) => a.x - b.x)
            .map((s) => s.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (!plainLineText) {
            i++;
            continue;
          }

          const sortedSpansForTabs = [...line.spans].sort((a, b) => a.x - b.x);
          const hasTabs = sortedSpansForTabs.some((s, idx) => {
            if (idx === 0) return false;
            const prev = sortedSpansForTabs[idx - 1];
            const gap = s.x - (prev.x + Math.max(0, prev.width));
            return gap >= Math.max(18, s.fontSize * 1.45);
          });
          const leftMargin = line.minX;
          const rightMargin = Math.max(0, pageW - line.maxX);
          const isCentered =
            Math.abs(leftMargin - rightMargin) < 26 &&
            line.maxX - line.minX < pageW * 0.72 &&
            leftMargin > pageW * 0.14;
          const isRightAligned =
            rightMargin < pageW * 0.16 && leftMargin > pageW * 0.48 && !isCentered;
          const isBullet = /^([•▪‣◦\-*]|\d+[.)])\s+/.test(plainLineText);

          if (line.avgFontSize >= medianSize * 1.42 && plainLineText.length < 120) {
            docParagraphs.push(
              new Paragraph({
                heading: HeadingLevel.HEADING_1,
                alignment: isCentered ? AlignmentType.CENTER : AlignmentType.LEFT,
                spacing: { before: 220, after: 110 },
                children: buildLineRuns(line, settings.fontSize, true),
              })
            );
            i++;
            continue;
          }

          if (line.avgFontSize >= medianSize * 1.16 && plainLineText.length < 140) {
            docParagraphs.push(
              new Paragraph({
                heading: HeadingLevel.HEADING_2,
                alignment: isCentered ? AlignmentType.CENTER : AlignmentType.LEFT,
                spacing: { before: 160, after: 80 },
                children: buildLineRuns(line, settings.fontSize, true),
              })
            );
            i++;
            continue;
          }

          // Combinar líneas sucesivas del mismo bloque de párrafo si tienen margen izquierdo similar y salto normal
          const mergedRuns: TextRun[] = [...runs];
          let currentLine = line;

          while (
            !isCentered &&
            !isRightAligned &&
            !isBullet &&
            !hasTabs &&
            i + 1 < lines.length
          ) {
            const nextLine = lines[i + 1];
            const verticalGap = currentLine.y - nextLine.y;
            const normalLineStep = currentLine.avgFontSize * 1.55;
            const sameMargin = Math.abs(nextLine.minX - line.minX) <= 18;
            const sameSize = Math.abs(nextLine.avgFontSize - currentLine.avgFontSize) <= 1.5;
            const nextText = nextLine.spans
              .map((s) => s.text)
              .join(' ')
              .trim();
            const nextIsHeading = nextLine.avgFontSize >= medianSize * 1.16 && nextText.length < 140;
            const nextIsBullet = /^([•▪‣◦\-*]|\d+[.)])\s+/.test(nextText);

            if (
              verticalGap > 0 &&
              verticalGap <= normalLineStep &&
              sameMargin &&
              sameSize &&
              !nextIsHeading &&
              !nextIsBullet &&
              plainLineText.length > 32
            ) {
              mergedRuns.push(new TextRun({ text: ' ', size: settings.fontSize * 2 }));
              mergedRuns.push(...buildLineRuns(nextLine, settings.fontSize, false));
              currentLine = nextLine;
              i++;
            } else {
              break;
            }
          }

          docParagraphs.push(
            new Paragraph({
              alignment: isCentered
                ? AlignmentType.CENTER
                : isRightAligned
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT,
              spacing: { after: isBullet ? 70 : 110, line: 276 },
              tabStops: [
                { type: TabStopType.LEFT, position: 2600 },
                { type: TabStopType.LEFT, position: 5200 },
                { type: TabStopType.LEFT, position: 7600 },
              ],
              children: mergedRuns,
            })
          );
          i++;
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
          properties: {
            page: {
              size: {
                width: defaultPageWTwips,
                height: defaultPageHTwips,
              },
              margin: {
                top: marginTwips,
                right: marginTwips,
                bottom: marginTwips,
                left: marginTwips,
              },
            },
          },
          children: docParagraphs,
        },
      ],
    });

    const blob = await Packer.toBlob(wordDoc);
    onProgress({
      active: false,
      percent: 100,
      stage: 'Completado',
      currentPage: totalPages,
      totalPages,
    });

    return {
      blob,
      fileName: `${stripExtension(file.name)}_a_word.docx`,
      pageCount: totalPages,
    };
  } finally {
    await Promise.race([
      Promise.allSettled([pdf.cleanup().catch(() => {}), loadingTask.destroy().catch(() => {})]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
}

function buildPrintableHtmlDocument(bodyHtml: string, settings: WordConversionSettings): string {
  const pageRule = settings.pageSize === 'letter' ? 'letter' : 'A4';
  const baseFontSize = settings.fontSize || 11;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<style>
  @page {
    size: ${pageRule};
    margin: 18mm 18mm 20mm 18mm;
  }
  * {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    padding: 0;
    font-family: 'Segoe UI', 'Calibri', Arial, Helvetica, sans-serif;
    font-size: ${baseFontSize}pt;
    line-height: 1.5;
    color: #1e293b;
    background: #ffffff;
    word-wrap: break-word;
  }
  h1, h2, h3, h4, h5, h6 {
    color: #0f172a;
    margin-top: 1.1em;
    margin-bottom: 0.45em;
    line-height: 1.25;
    page-break-after: avoid;
  }
  h1 { font-size: ${baseFontSize + 7}pt; }
  h2 { font-size: ${baseFontSize + 4}pt; }
  h3 { font-size: ${baseFontSize + 2}pt; }
  h4 { font-size: ${baseFontSize + 1}pt; }
  p {
    margin: 0 0 0.65em 0;
  }
  ul, ol {
    margin: 0 0 0.75em 0;
    padding-left: 1.5em;
  }
  li {
    margin-bottom: 0.25em;
  }
  blockquote {
    margin: 0.7em 0;
    padding: 0.4em 0.9em;
    border-left: 3px solid #94a3b8;
    background: #f8fafc;
    color: #334155;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0.8em 0;
    font-size: ${Math.max(9, baseFontSize - 0.5)}pt;
    page-break-inside: auto;
  }
  tr {
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 6px 8px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background: #f1f5f9;
    font-weight: 700;
    color: #0f172a;
  }
  img {
    max-width: 100%;
    height: auto;
    display: inline-block;
    page-break-inside: avoid;
  }
  hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 1em 0;
  }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

interface InlineRun {
  text: string;
  bold: boolean;
  italic: boolean;
}

type WebDocxBlock =
  | { kind: 'h1' | 'h2' | 'h3' | 'li' | 'p' | 'blockquote'; runs: InlineRun[] }
  | { kind: 'table'; rows: { isHeader: boolean; cells: string[] }[] }
  | { kind: 'image'; dataUrl: string };

function collectInlineRuns(node: Node, bold = false, italic = false): InlineRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = (node.textContent || '').replace(/\s+/g, ' ');
    return text ? [{ text, bold, italic }] : [];
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'br') return [{ text: ' ', bold, italic }];

  const nextBold = bold || tag === 'strong' || tag === 'b' || tag === 'th';
  const nextItalic = italic || tag === 'em' || tag === 'i';
  const out: InlineRun[] = [];
  el.childNodes.forEach((child) => {
    out.push(...collectInlineRuns(child, nextBold, nextItalic));
  });
  return out;
}

function parseRichHtmlToBlocks(html: string): WebDocxBlock[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: WebDocxBlock[] = [];

  const walk = (root: HTMLElement) => {
    Array.from(root.children).forEach((child) => {
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === 'table') {
        const rows: { isHeader: boolean; cells: string[] }[] = [];
        el.querySelectorAll('tr').forEach((tr) => {
          const ths = tr.querySelectorAll('th');
          const cells = Array.from(tr.querySelectorAll('th, td')).map((c) =>
            (c.textContent || '').replace(/\s+/g, ' ').trim()
          );
          if (cells.length > 0) {
            rows.push({ isHeader: ths.length > 0, cells });
          }
        });
        if (rows.length > 0) blocks.push({ kind: 'table', rows });
        return;
      }

      if (tag === 'ul' || tag === 'ol') {
        const isOrdered = tag === 'ol';
        Array.from(el.children).forEach((li, idx) => {
          if (li.tagName.toLowerCase() !== 'li') return;
          const prefix = isOrdered ? `${idx + 1}. ` : '• ';
          const runs = [{ text: prefix, bold: true, italic: false }, ...collectInlineRuns(li)];
          if (runs.some((r) => r.text.trim())) {
            blocks.push({ kind: 'li', runs });
          }
        });
        return;
      }

      if (tag === 'img') {
        const src = el.getAttribute('src') || '';
        if (src.startsWith('data:image/')) {
          blocks.push({ kind: 'image', dataUrl: src });
        }
        return;
      }

      const nestedImages = Array.from(el.querySelectorAll('img'))
        .map((img) => img.getAttribute('src') || '')
        .filter((src) => src.startsWith('data:image/'));

      const runs = collectInlineRuns(el);
      const hasText = runs.some((r) => r.text.trim().length > 0);

      if (hasText) {
        const kind: WebDocxBlock & { kind: string } extends never
          ? never
          : 'h1' | 'h2' | 'h3' | 'p' | 'blockquote' =
          tag === 'h1'
            ? 'h1'
            : tag === 'h2'
            ? 'h2'
            : tag === 'h3' || tag === 'h4'
            ? 'h3'
            : tag === 'blockquote'
            ? 'blockquote'
            : 'p';
        blocks.push({ kind, runs });
      }

      for (const src of nestedImages) {
        blocks.push({ kind: 'image', dataUrl: src });
      }

      if (!hasText && nestedImages.length === 0 && el.children.length > 0) {
        walk(el);
      }
    });
  };

  walk(doc.body);
  return blocks;
}

async function decodeDataUrlForPdf(
  dataUrl: string
): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg' } | null> {
  try {
    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (!match) return null;
    const mime = match[1].toLowerCase();
    const res = await fetch(dataUrl);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (mime === 'image/png') return { bytes, kind: 'png' };
    if (mime === 'image/jpeg' || mime === 'image/jpg') return { bytes, kind: 'jpg' };

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, img.naturalWidth);
    canvas.height = Math.max(1, img.naturalHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    canvas.width = 0;
    canvas.height = 0;
    if (!pngBlob) return null;
    return { bytes: new Uint8Array(await pngBlob.arrayBuffer()), kind: 'png' };
  } catch {
    return null;
  }
}

export async function docxToPdf(
  file: File,
  settings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  onProgress({
    active: true,
    percent: 16,
    stage: 'Analizando formato, tablas e imágenes del documento Word...',
  });

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const bridge = getDesktopBridge();

  if (bridge?.renderHtmlToPdf) {
    onProgress({
      active: true,
      percent: 52,
      stage: 'Renderizando PDF vectorial de alta fidelidad...',
    });

    const printableHtml = buildPrintableHtmlDocument(result.value, settings);
    const pdfBytes = await bridge.renderHtmlToPdf({
      html: printableHtml,
      pageSize: settings.pageSize,
    });
    const parsedDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageCount = parsedDoc.getPageCount();

    onProgress({
      active: false,
      percent: 100,
      stage: 'Completado',
      currentPage: pageCount,
      totalPages: pageCount,
    });

    return {
      blob: new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' }),
      fileName: `${stripExtension(file.name)}_a_pdf.pdf`,
      pageCount,
    };
  }

  // Respaldo web enriquecido (conserva negritas, cursivas, tablas e imágenes embebidas)
  const blocks = parseRichHtmlToBlocks(result.value);

  onProgress({
    active: true,
    percent: 45,
    stage: 'Maquetando tipografía, tablas e imágenes en PDF...',
  });

  const pdfDoc = await PDFDocument.create();
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const boldItalicFont = await pdfDoc.embedFont(StandardFonts.HelveticaBoldOblique);

  const pickFont = (bold: boolean, italic: boolean): PDFFont => {
    if (bold && italic) return boldItalicFont;
    if (bold) return boldFont;
    if (italic) return italicFont;
    return regularFont;
  };

  const pageSize = settings.pageSize === 'letter' ? PageSizes.Letter : PageSizes.A4;
  const [pageW, pageH] = pageSize;
  const margin = 52;
  const maxWidth = pageW - margin * 2;

  let page = pdfDoc.addPage([pageW, pageH]);
  let cursorY = pageH - margin;

  const ensureSpace = (neededHeight: number) => {
    if (cursorY - neededHeight < margin + 18) {
      page = pdfDoc.addPage([pageW, pageH]);
      cursorY = pageH - margin;
    }
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];

    if (block.kind === 'image') {
      const decoded = await decodeDataUrlForPdf(block.dataUrl);
      if (decoded) {
        const embedded =
          decoded.kind === 'png'
            ? await pdfDoc.embedPng(decoded.bytes)
            : await pdfDoc.embedJpg(decoded.bytes);
        const scale = Math.min(1, maxWidth / Math.max(1, embedded.width), (pageH - margin * 2) / Math.max(1, embedded.height));
        const drawW = embedded.width * scale;
        const drawH = embedded.height * scale;
        ensureSpace(drawH + 10);
        page.drawImage(embedded, {
          x: margin,
          y: cursorY - drawH,
          width: drawW,
          height: drawH,
        });
        cursorY -= drawH + 12;
      }
      continue;
    }

    if (block.kind === 'table') {
      const colCount = Math.max(1, ...block.rows.map((r) => r.cells.length));
      const colW = maxWidth / colCount;
      const cellPad = 6;
      const cellFontSize = Math.max(9, settings.fontSize - 1);
      const cellLineH = cellFontSize * 1.32;

      for (const row of block.rows) {
        const font = row.isHeader ? boldFont : regularFont;
        const wrappedCols = row.cells.map((cellText) => {
          const safe = sanitizeWinAnsiText(cellText);
          const words = safe.split(' ');
          const linesOut: string[] = [];
          let curr = '';
          for (const w of words) {
            const cand = curr ? `${curr} ${w}` : w;
            if (font.widthOfTextAtSize(cand, cellFontSize) <= colW - cellPad * 2) {
              curr = cand;
            } else {
              if (curr) linesOut.push(curr);
              curr = w;
            }
          }
          if (curr) linesOut.push(curr);
          return linesOut.length > 0 ? linesOut : [''];
        });

        const maxLines = Math.max(1, ...wrappedCols.map((c) => c.length));
        const rowH = maxLines * cellLineH + cellPad * 2;
        ensureSpace(rowH + 4);

        for (let c = 0; c < colCount; c++) {
          const cellX = margin + c * colW;
          page.drawRectangle({
            x: cellX,
            y: cursorY - rowH,
            width: colW,
            height: rowH,
            color: row.isHeader ? rgb(0.94, 0.96, 0.98) : rgb(1, 1, 1),
            borderColor: rgb(0.78, 0.82, 0.88),
            borderWidth: 0.75,
          });
          const linesForCell = wrappedCols[c] || [];
          linesForCell.forEach((lineStr, li) => {
            page.drawText(lineStr, {
              x: cellX + cellPad,
              y: cursorY - cellPad - cellFontSize - li * cellLineH + 2,
              size: cellFontSize,
              font,
              color: rgb(0.1, 0.14, 0.2),
            });
          });
        }
        cursorY -= rowH;
      }
      cursorY -= 10;
      continue;
    }

    const isHeading = block.kind === 'h1' || block.kind === 'h2' || block.kind === 'h3';
    const fontSize =
      block.kind === 'h1'
        ? settings.fontSize + 7
        : block.kind === 'h2'
        ? settings.fontSize + 4
        : block.kind === 'h3'
        ? settings.fontSize + 2
        : settings.fontSize;
    const lineHeight = fontSize * 1.42;

    if (isHeading) cursorY -= 8;

    // Aplanar tokens por palabra conservando estilo bold/italic
    const wordTokens: { text: string; font: PDFFont }[] = [];
    for (const run of block.runs) {
      const f = pickFont(isHeading || run.bold, run.italic);
      const safe = sanitizeWinAnsiText(run.text);
      const parts = safe.split(' ');
      parts.forEach((p, idx) => {
        if (p) wordTokens.push({ text: p, font: f });
        if (idx < parts.length - 1) wordTokens.push({ text: ' ', font: f });
      });
    }

    const linesToDraw: { text: string; font: PDFFont }[][] = [];
    let currentLineTokens: { text: string; font: PDFFont }[] = [];
    let currentLineW = 0;

    for (const tok of wordTokens) {
      const tokW = tok.font.widthOfTextAtSize(tok.text, fontSize);
      if (tok.text === ' ' && currentLineTokens.length === 0) continue;
      if (currentLineW + tokW <= maxWidth || currentLineTokens.length === 0) {
        currentLineTokens.push(tok);
        currentLineW += tokW;
      } else {
        linesToDraw.push(currentLineTokens);
        currentLineTokens = tok.text === ' ' ? [] : [tok];
        currentLineW = tok.text === ' ' ? 0 : tokW;
      }
    }
    if (currentLineTokens.length > 0) linesToDraw.push(currentLineTokens);

    for (const lineTokens of linesToDraw) {
      ensureSpace(lineHeight);
      let x = margin + (block.kind === 'blockquote' ? 12 : 0);
      for (const tok of lineTokens) {
        page.drawText(tok.text, {
          x,
          y: cursorY,
          size: fontSize,
          font: tok.font,
          color: isHeading ? rgb(0.06, 0.09, 0.16) : rgb(0.15, 0.19, 0.25),
        });
        x += tok.font.widthOfTextAtSize(tok.text, fontSize);
      }
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
    fileName: `${stripExtension(file.name)}_a_pdf.pdf`,
    pageCount: pages.length,
  };
}
