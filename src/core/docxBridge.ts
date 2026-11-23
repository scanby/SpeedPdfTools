import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ISectionOptions,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import mammoth from 'mammoth';
import { PDFDocument, PDFFont, PageSizes, StandardFonts, rgb } from 'pdf-lib';
import { ProgressState, WordConversionSettings } from '../types/speedpdf';
import { getDesktopBridge } from './desktopBridge';
import { sanitizeWinAnsiText, stripExtension, yieldToMain } from './formatters';
import { computeClampedRenderViewport, renderPageToCanvas } from './pdfEngine';
import {
  ExtractedLine,
  ExtractedSpan,
  PageLayoutNode,
  RectBox,
  buildStructuredPageLayout,
  extractPageSpansAndVisuals,
  hexLuminance,
} from './pdfLayoutExtractor';
import { formatPdfOpenError, openPdfDocument } from './pdfjsSetup';

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

function canvasCropToPngBytes(
  sourceCanvas: HTMLCanvasElement,
  box: RectBox,
  pageW: number,
  pageH: number
): Promise<Uint8Array | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const scaleX = sourceCanvas.width / Math.max(1, pageW);
  const scaleY = sourceCanvas.height / Math.max(1, pageH);
  const sx = Math.max(0, Math.floor(box.x0 * scaleX));
  const sy = Math.max(0, Math.floor(box.y0 * scaleY));
  const sw = Math.max(1, Math.min(sourceCanvas.width - sx, Math.ceil((box.x1 - box.x0) * scaleX)));
  const sh = Math.max(1, Math.min(sourceCanvas.height - sy, Math.ceil((box.y1 - box.y0) * scaleY)));
  if (sw < 4 || sh < 4) return Promise.resolve(null);

  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  const ctx = crop.getContext('2d');
  if (!ctx) {
    crop.width = 0;
    crop.height = 0;
    return Promise.resolve(null);
  }
  ctx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

  return new Promise((resolve) => {
    crop.toBlob(
      async (blob) => {
        crop.width = 0;
        crop.height = 0;
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new Uint8Array(await blob.arrayBuffer()));
      },
      'image/png'
    );
  });
}

function ptToTwips(pt: number): number {
  return Math.max(0, Math.round(pt * 20));
}

function buildLinePlainText(line: ExtractedLine): string {
  const sorted = [...line.spans].sort((a, b) => a.x0 - b.x0);
  let out = '';
  for (let i = 0; i < sorted.length; i++) {
    const span = sorted[i];
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = span.x0 - prev.x1;
      const spaceThreshold = Math.max(1.6, span.fontSize * 0.2);
      if (gap >= spaceThreshold && !prev.text.endsWith(' ') && !span.text.startsWith(' ')) {
        out += ' ';
      }
    }
    out += span.text;
  }
  return out.replace(/\s+/g, ' ').trim();
}

function buildLineRuns(
  line: ExtractedLine,
  medianBodyPt: number,
  options: { isHeading?: boolean; forceColorHex?: string } = {}
): TextRun[] {
  const sorted = [...line.spans].sort((a, b) => a.x0 - b.x0);
  const runs: TextRun[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const span = sorted[i];
    let prefix = '';

    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = span.x0 - prev.x1;
      const spaceThreshold = Math.max(1.6, span.fontSize * 0.2);
      if (gap >= spaceThreshold && !prev.text.endsWith(' ') && !span.text.startsWith(' ')) {
        prefix = ' ';
      }
    }

    const runText = `${prefix}${span.text}`;
    if (!runText) continue;

    const effectiveSizePt =
      Math.abs(span.fontSize - medianBodyPt) <= 0.65 ? medianBodyPt : span.fontSize;
    const halfPts = Math.max(13, Math.min(84, Math.round(effectiveSizePt * 2)));
    const color = options.forceColorHex || span.colorHex || '1E293B';

    runs.push(
      new TextRun({
        text: runText,
        font: span.fontFamily,
        bold: options.isHeading ? true : span.bold,
        italics: span.italic,
        size: halfPts,
        color,
      })
    );
  }

  return runs;
}

const NO_TABLE_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'auto' },
};

const SUBTLE_GRID_BORDERS = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'CBD5E1' },
};

function renderProseLinesToParagraphs(
  lines: ExtractedLine[],
  region: RectBox,
  medianBodyPt: number,
  bgHex?: string
): Paragraph[] {
  if (lines.length === 0) return [];
  const out: Paragraph[] = [];
  const blockLeft = Math.min(...lines.map((l) => l.minX));
  const blockRight = Math.max(region.x1, ...lines.map((l) => l.maxX));
  const blockWidth = Math.max(40, blockRight - blockLeft);

  const contrastColor =
    bgHex && hexLuminance(bgHex) < 0.42 ? 'FFFFFF' : undefined;
  const paragraphShading = bgHex
    ? { type: ShadingType.CLEAR, color: 'auto', fill: bgHex }
    : undefined;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const plainLine = buildLinePlainText(line);
    if (!plainLine) {
      i++;
      continue;
    }

    const leftOffset = Math.max(0, line.minX - region.x0);
    const rightSpace = Math.max(0, blockRight - line.maxX);
    const lineSpanW = Math.max(1, line.maxX - line.minX);

    const isCentered =
      blockWidth > 120 &&
      Math.abs(line.minX - region.x0 - rightSpace) <= 22 &&
      lineSpanW < blockWidth * 0.78 &&
      leftOffset > blockWidth * 0.12;
    const isRightAligned =
      !isCentered &&
      blockWidth > 120 &&
      rightSpace <= 16 &&
      leftOffset > blockWidth * 0.42;
    const isBullet = /^([•▪‣◦\-*–]|\d+[.)]|[a-zA-Z][.)])\s+/.test(plainLine);

    if (line.avgFontSize >= medianBodyPt * 1.38 && plainLine.length < 130) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: isCentered
            ? AlignmentType.CENTER
            : isRightAligned
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT,
          indent: !isCentered && !isRightAligned && leftOffset > 12 ? { left: ptToTwips(leftOffset) } : undefined,
          shading: paragraphShading,
          spacing: { before: 140, after: 80 },
          children: buildLineRuns(line, medianBodyPt, {
            isHeading: true,
            forceColorHex: contrastColor,
          }),
        })
      );
      i++;
      continue;
    }

    if (line.avgFontSize >= medianBodyPt * 1.15 && plainLine.length < 150) {
      out.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          alignment: isCentered
            ? AlignmentType.CENTER
            : isRightAligned
            ? AlignmentType.RIGHT
            : AlignmentType.LEFT,
          indent: !isCentered && !isRightAligned && leftOffset > 12 ? { left: ptToTwips(leftOffset) } : undefined,
          shading: paragraphShading,
          spacing: { before: 110, after: 60 },
          children: buildLineRuns(line, medianBodyPt, {
            isHeading: true,
            forceColorHex: contrastColor,
          }),
        })
      );
      i++;
      continue;
    }

    const mergedRuns: TextRun[] = [
      ...buildLineRuns(line, medianBodyPt, { forceColorHex: contrastColor }),
    ];
    let currentLine = line;
    let wrappedLineCount = 1;

    while (!isCentered && !isRightAligned && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const verticalGap = nextLine.ty - currentLine.ty;
      const maxNormalStep = Math.max(currentLine.avgFontSize, nextLine.avgFontSize) * 1.62;
      const nextPlain = buildLinePlainText(nextLine);
      const nextIsHeading =
        nextLine.avgFontSize >= medianBodyPt * 1.15 && nextPlain.length < 150;
      const nextIsBullet = /^([•▪‣◦\-*–]|\d+[.)]|[a-zA-Z][.)])\s+/.test(nextPlain);

      const sameStartIndent = isBullet
        ? nextLine.minX >= line.minX - 6 && nextLine.minX <= line.minX + 26
        : Math.abs(nextLine.minX - line.minX) <= 14;
      const sameFontScale = Math.abs(nextLine.avgFontSize - currentLine.avgFontSize) <= 1.5;

      // Verificar si la línea actual realmente llegó cerca del borde derecho del bloque
      // (si terminó muy corta y no es parte de un párrafo ya en curso, es un salto intencional como dirección o firma)
      const currentReachedNearEdge =
        currentLine.maxX >= blockRight - Math.max(36, currentLine.avgFontSize * 5.2);
      const nextRightMargin = Math.max(0, blockRight - nextLine.maxX);
      const nextNotRightAligned = !(nextRightMargin <= 16 && nextLine.minX - region.x0 > blockWidth * 0.45);

      if (
        verticalGap > 0 &&
        verticalGap <= maxNormalStep &&
        sameStartIndent &&
        sameFontScale &&
        !nextIsHeading &&
        !nextIsBullet &&
        nextNotRightAligned &&
        (currentReachedNearEdge || plainLine.length >= 52)
      ) {
        const lastRunColor = contrastColor || nextLine.spans[0]?.colorHex || '1E293B';
        mergedRuns.push(
          new TextRun({
            text: ' ',
            font: nextLine.spans[0]?.fontFamily || 'Calibri',
            size: Math.max(13, Math.round(nextLine.avgFontSize * 2)),
            color: lastRunColor,
          })
        );
        mergedRuns.push(
          ...buildLineRuns(nextLine, medianBodyPt, { forceColorHex: contrastColor })
        );
        currentLine = nextLine;
        wrappedLineCount++;
        i++;
      } else {
        break;
      }
    }

    const indentLeftTwips =
      !isCentered && !isRightAligned && leftOffset > 10 ? ptToTwips(leftOffset) : 0;
    const isJustified =
      !isCentered &&
      !isRightAligned &&
      !isBullet &&
      wrappedLineCount >= 2 &&
      currentLine.maxX < blockRight - 24 &&
      line.maxX >= blockRight - 28;

    out.push(
      new Paragraph({
        alignment: isCentered
          ? AlignmentType.CENTER
          : isRightAligned
          ? AlignmentType.RIGHT
          : isJustified
          ? AlignmentType.JUSTIFIED
          : AlignmentType.LEFT,
        indent: indentLeftTwips > 0 ? { left: indentLeftTwips } : undefined,
        shading: paragraphShading,
        spacing: {
          after: isBullet ? 55 : 85,
          line: 264,
        },
        children: mergedRuns,
      })
    );
    i++;
  }

  return out;
}

function scaleWidthsToAvailableTwips(widthsPt: number[], targetTwips: number): number[] {
  const sumPt = widthsPt.reduce((a, b) => a + b, 0) || 1;
  const rawTwips = widthsPt.map((w) => Math.max(360, Math.round((w / sumPt) * targetTwips)));
  const currentTotal = rawTwips.reduce((a, b) => a + b, 0);
  if (rawTwips.length > 0 && currentTotal !== targetTwips) {
    rawTwips[rawTwips.length - 1] = Math.max(
      360,
      rawTwips[rawTwips.length - 1] + (targetTwips - currentTotal)
    );
  }
  return rawTwips;
}

async function renderLayoutNodesToDocxChildren(
  nodes: PageLayoutNode[],
  availWidthTwips: number,
  medianBodyPt: number,
  getCroppedImageBytes: (box: RectBox) => Promise<Uint8Array | null>
): Promise<(Paragraph | Table)[]> {
  const children: (Paragraph | Table)[] = [];

  for (const node of nodes) {
    if (node.kind === 'prose') {
      children.push(
        ...renderProseLinesToParagraphs(node.lines, node.region, medianBodyPt, node.bgHex)
      );
      continue;
    }

    if (node.kind === 'image') {
      const pngBytes = await getCroppedImageBytes(node.box);
      if (pngBytes) {
        const boxW = Math.max(24, node.box.x1 - node.box.x0);
        const boxH = Math.max(24, node.box.y1 - node.box.y0);
        const maxWidthPx = Math.max(80, Math.round((availWidthTwips / 1440) * 96));
        const rawW = Math.round(boxW * (96 / 72));
        const rawH = Math.round(boxH * (96 / 72));
        const ratio = Math.min(1, maxWidthPx / Math.max(1, rawW));
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 80 },
            children: [
              new ImageRun({
                type: 'png',
                data: pngBytes,
                transformation: {
                  width: Math.max(24, Math.round(rawW * ratio)),
                  height: Math.max(24, Math.round(rawH * ratio)),
                },
              }),
            ],
          })
        );
      }
      continue;
    }

    if (node.kind === 'table') {
      const colWidthsTwips = scaleWidthsToAvailableTwips(node.colWidthsPt, availWidthTwips);
      const tableRows = node.rows.map(
        (row) =>
          new TableRow({
            tableHeader: row.isHeader,
            children: row.cells.map((cell, cIdx) => {
              const cellW = colWidthsTwips[cIdx] ?? Math.round(availWidthTwips / Math.max(1, node.colWidthsPt.length));
              const contrastHex =
                cell.bgHex && hexLuminance(cell.bgHex) < 0.42 ? 'FFFFFF' : undefined;
              const cellParagraphs = cell.lines.map(
                (line) =>
                  new Paragraph({
                    alignment:
                      cell.align === 'center'
                        ? AlignmentType.CENTER
                        : cell.align === 'right'
                        ? AlignmentType.RIGHT
                        : AlignmentType.LEFT,
                    spacing: { before: 20, after: 20 },
                    children: buildLineRuns(line, medianBodyPt, {
                      isHeading: row.isHeader,
                      forceColorHex: contrastHex,
                    }),
                  })
              );

              return new TableCell({
                width: { size: cellW, type: WidthType.DXA },
                verticalAlign: VerticalAlign.CENTER,
                margins: { top: 75, bottom: 75, left: 100, right: 100 },
                shading: cell.bgHex
                  ? { type: ShadingType.CLEAR, color: 'auto', fill: cell.bgHex }
                  : undefined,
                children:
                  cellParagraphs.length > 0
                    ? cellParagraphs
                    : [new Paragraph({ children: [new TextRun('')] })],
              });
            }),
          })
      );

      children.push(
        new Table({
          width: { size: availWidthTwips, type: WidthType.DXA },
          layout: TableLayoutType.FIXED,
          columnWidths: colWidthsTwips,
          borders: node.hasBorders ? SUBTLE_GRID_BORDERS : NO_TABLE_BORDERS,
          rows: tableRows,
        })
      );
      children.push(new Paragraph({ spacing: { before: 0, after: 80 } }));
      continue;
    }

    if (node.kind === 'columns') {
      const colWidthsTwips = scaleWidthsToAvailableTwips(node.colWidthsPt, availWidthTwips);
      const cells: TableCell[] = [];
      for (let cIdx = 0; cIdx < node.columns.length; cIdx++) {
        const colNodes = node.columns[cIdx];
        const cellW = colWidthsTwips[cIdx] ?? Math.round(availWidthTwips / Math.max(1, node.columns.length));
        const innerAvailTwips = Math.max(360, cellW - 140);
        const cellChildren = await renderLayoutNodesToDocxChildren(
          colNodes,
          innerAvailTwips,
          medianBodyPt,
          getCroppedImageBytes
        );
        cells.push(
          new TableCell({
            width: { size: cellW, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: {
              top: 20,
              bottom: 20,
              left: cIdx === 0 ? 0 : 90,
              right: cIdx === node.columns.length - 1 ? 0 : 90,
            },
            children:
              cellChildren.length > 0
                ? cellChildren
                : [new Paragraph({ children: [new TextRun('')] })],
          })
        );
      }

      children.push(
        new Table({
          width: { size: availWidthTwips, type: WidthType.DXA },
          layout: TableLayoutType.FIXED,
          columnWidths: colWidthsTwips,
          borders: NO_TABLE_BORDERS,
          rows: [new TableRow({ children: cells })],
        })
      );
      children.push(new Paragraph({ spacing: { before: 0, after: 60 } }));
    }
  }

  return children;
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

        const rawWTwips = Math.max(1440, Math.round(baseViewport.width * 20));
        const rawHTwips = Math.max(1440, Math.round(baseViewport.height * 20));
        const isLandscape = rawWTwips > rawHTwips;
        const widthPx = Math.max(100, Math.round(baseViewport.width * (96 / 72)));
        const heightPx = Math.max(100, Math.round(baseViewport.height * (96 / 72)));

        sections.push({
          properties: {
            page: {
              size: isLandscape
                ? {
                    width: rawHTwips,
                    height: rawWTwips,
                    orientation: PageOrientation.LANDSCAPE,
                  }
                : {
                    width: rawWTwips,
                    height: rawHTwips,
                    orientation: PageOrientation.PORTRAIT,
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

    // Modo editable con reconstrucción geométrica XY-Cut (columnas, tablas reales, márgenes, colores e imágenes)
    const sections: ISectionOptions[] = [];
    const continuousChildren: (Paragraph | Table)[] = [];
    const defaultPageWTwips = settings.pageSize === 'letter' ? 12240 : 11906;
    const defaultPageHTwips = settings.pageSize === 'letter' ? 15840 : 16838;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / Math.max(1, totalPages)) * 85) + 5,
        stage: `Reconstruyendo columnas, tablas y estructura de página ${pageNum}/${totalPages}...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const pageW = Math.max(200, baseViewport.width);
      const pageH = Math.max(200, baseViewport.height);

      const { spans, visuals } = await extractPageSpansAndVisuals(page, baseViewport);

      const rawPageWTwips = Math.max(2880, Math.min(31680, Math.round(pageW * 20)));
      const rawPageHTwips = Math.max(2880, Math.min(31680, Math.round(pageH * 20)));
      const isLandscape = rawPageWTwips > rawPageHTwips;

      let pageChildren: (Paragraph | Table)[] = [];
      let marginsPt = { top: 54, right: 54, bottom: 54, left: 54 };

      if (spans.length === 0) {
        // Página escaneada o puramente gráfica sin capa de texto: incrustar captura nítida a 200 DPI
        if (typeof document !== 'undefined') {
          const { renderViewport } = computeClampedRenderViewport(page, 200, 0);
          const canvas = await renderPageToCanvas(page, renderViewport, false);
          let jpegBytes: Uint8Array;
          try {
            jpegBytes = await canvasToJpegBytes(canvas, 0.93);
          } finally {
            canvas.width = 0;
            canvas.height = 0;
          }
          const availWTwips = rawPageWTwips - 1440;
          const availHTwips = rawPageHTwips - 1440;
          const contentWidthPx = Math.round((availWTwips / 1440) * 96);
          const maxHeightPx = Math.round((availHTwips / 1440) * 96);
          const ratio = Math.min(
            contentWidthPx / pageW,
            maxHeightPx / pageH
          );
          pageChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  type: 'jpg',
                  data: jpegBytes,
                  transformation: {
                    width: Math.max(80, Math.round(pageW * ratio)),
                    height: Math.max(80, Math.round(pageH * ratio)),
                  },
                }),
              ],
            })
          );
        }
      } else {
        const layout = buildStructuredPageLayout(spans, visuals, pageW, pageH);
        marginsPt = layout.marginsPt;

        const sizes = spans.map((s) => s.fontSize).sort((a, b) => a - b);
        const medianBodyPt = sizes[Math.floor(sizes.length / 2)] || settings.fontSize || 11;
        const availWidthTwips = Math.max(
          1440,
          rawPageWTwips - ptToTwips(marginsPt.left) - ptToTwips(marginsPt.right)
        );

        let renderedPageCanvas: HTMLCanvasElement | null = null;
        if (layout.standaloneImages.length > 0 && typeof document !== 'undefined') {
          try {
            const { renderViewport } = computeClampedRenderViewport(page, 165, 0);
            renderedPageCanvas = await renderPageToCanvas(page, renderViewport, false);
          } catch {
            renderedPageCanvas = null;
          }
        }

        try {
          pageChildren = await renderLayoutNodesToDocxChildren(
            layout.nodes,
            availWidthTwips,
            medianBodyPt,
            async (box) => {
              if (!renderedPageCanvas) return null;
              return canvasCropToPngBytes(renderedPageCanvas, box, pageW, pageH);
            }
          );
        } finally {
          if (renderedPageCanvas) {
            renderedPageCanvas.width = 0;
            renderedPageCanvas.height = 0;
          }
        }
      }

      if (settings.preservePageBreaks) {
        sections.push({
          properties: {
            page: {
              size: isLandscape
                ? {
                    width: rawPageHTwips,
                    height: rawPageWTwips,
                    orientation: PageOrientation.LANDSCAPE,
                  }
                : {
                    width: rawPageWTwips,
                    height: rawPageHTwips,
                    orientation: PageOrientation.PORTRAIT,
                  },
              margin: {
                top: ptToTwips(marginsPt.top),
                right: ptToTwips(marginsPt.right),
                bottom: ptToTwips(marginsPt.bottom),
                left: ptToTwips(marginsPt.left),
              },
            },
          },
          children:
            pageChildren.length > 0
              ? pageChildren
              : [new Paragraph({ children: [new TextRun('')] })],
        });
      } else {
        continuousChildren.push(...pageChildren);
      }

      page.cleanup();
      await yieldToMain();
    }

    onProgress({
      active: true,
      percent: 94,
      stage: 'Generando archivo Word (.docx) estructurado...',
      currentPage: totalPages,
      totalPages,
    });

    const wordDoc = new Document({
      creator: 'SPEED.PDF',
      title: stripExtension(file.name),
      sections: settings.preservePageBreaks
        ? sections
        : [
            {
              properties: {
                page: {
                  size: {
                    width: defaultPageWTwips,
                    height: defaultPageHTwips,
                    orientation: PageOrientation.PORTRAIT,
                  },
                  margin: {
                    top: 1008,
                    right: 1008,
                    bottom: 1008,
                    left: 1008,
                  },
                },
              },
              children:
                continuousChildren.length > 0
                  ? continuousChildren
                  : [new Paragraph({ children: [new TextRun('')] })],
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
