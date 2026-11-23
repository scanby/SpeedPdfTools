import { pdfjsLib } from './pdfjsSetup';

export interface RectBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface ExtractedSpan {
  x0: number;
  x1: number;
  topY: number;
  bottomY: number;
  ty: number;
  width: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  colorHex?: string;
}

export interface ExtractedLine {
  ty: number;
  topY: number;
  bottomY: number;
  minX: number;
  maxX: number;
  avgFontSize: number;
  spans: ExtractedSpan[];
}

export interface PageHorizontalRule {
  y: number;
  x0: number;
  x1: number;
  colorHex: string;
}

export interface PageVerticalRule {
  x: number;
  y0: number;
  y1: number;
  colorHex: string;
}

export interface PageFilledRect extends RectBox {
  fillHex: string;
}

export interface PageVisualHints {
  hRules: PageHorizontalRule[];
  vRules: PageVerticalRule[];
  bgRects: PageFilledRect[];
  imageBoxes: RectBox[];
}

export interface TableCellBlock {
  spans: ExtractedSpan[];
  lines: ExtractedLine[];
  bgHex?: string;
  align: 'left' | 'center' | 'right';
}

export interface TableRowBlock {
  isHeader: boolean;
  cells: TableCellBlock[];
}

export type PageLayoutNode =
  | {
      kind: 'prose';
      region: RectBox;
      lines: ExtractedLine[];
      bgHex?: string;
    }
  | {
      kind: 'table';
      region: RectBox;
      colWidthsPt: number[];
      hasBorders: boolean;
      rows: TableRowBlock[];
    }
  | {
      kind: 'columns';
      region: RectBox;
      colWidthsPt: number[];
      columns: PageLayoutNode[][];
    }
  | {
      kind: 'image';
      region: RectBox;
      box: RectBox;
    };

export function multiplyMatrix(
  m1: readonly number[],
  m2: readonly number[]
): [number, number, number, number, number, number] {
  return [
    (m1[0] ?? 1) * (m2[0] ?? 1) + (m1[2] ?? 0) * (m2[1] ?? 0),
    (m1[1] ?? 0) * (m2[0] ?? 1) + (m1[3] ?? 1) * (m2[1] ?? 0),
    (m1[0] ?? 1) * (m2[2] ?? 0) + (m1[2] ?? 0) * (m2[3] ?? 1),
    (m1[1] ?? 0) * (m2[2] ?? 0) + (m1[3] ?? 1) * (m2[3] ?? 1),
    (m1[0] ?? 1) * (m2[4] ?? 0) + (m1[2] ?? 0) * (m2[5] ?? 0) + (m1[4] ?? 0),
    (m1[1] ?? 0) * (m2[4] ?? 0) + (m1[3] ?? 1) * (m2[5] ?? 0) + (m1[5] ?? 0),
  ];
}

function transformPoint(
  m: readonly number[],
  x: number,
  y: number
): [number, number] {
  return [
    (m[0] ?? 1) * x + (m[2] ?? 0) * y + (m[4] ?? 0),
    (m[1] ?? 0) * x + (m[3] ?? 1) * y + (m[5] ?? 0),
  ];
}

function transformBBox(m: readonly number[], minX: number, minY: number, maxX: number, maxY: number): RectBox {
  const pts = [
    transformPoint(m, minX, minY),
    transformPoint(m, maxX, minY),
    transformPoint(m, minX, maxY),
    transformPoint(m, maxX, maxY),
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0').toUpperCase();
}

function normalizeColorArgsToHex(args: unknown): string | null {
  if (!Array.isArray(args) || args.length === 0) return null;
  if (typeof args[0] === 'string' && /^#[0-9a-f]{6}$/i.test(args[0])) {
    return args[0].slice(1).toUpperCase();
  }
  if (args.length >= 3 && args.every((v) => typeof v === 'number')) {
    const [r, g, b] = args as number[];
    const scale = r <= 1 && g <= 1 && b <= 1 ? 255 : 1;
    return `${toHexByte(r * scale)}${toHexByte(g * scale)}${toHexByte(b * scale)}`;
  }
  return null;
}

function normalizeGrayArgToHex(args: unknown): string | null {
  if (!Array.isArray(args) || typeof args[0] !== 'number') return null;
  const g = args[0] <= 1 ? args[0] * 255 : args[0];
  const byte = toHexByte(g);
  return `${byte}${byte}${byte}`;
}

export function hexLuminance(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return 1;
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isNearWhiteHex(hex: string): boolean {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return false;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return r >= 246 && g >= 246 && b >= 246;
}

function detectFontStyle(
  fontName: string,
  fontFamily?: string
): { bold: boolean; italic: boolean; cleanFamily: string } {
  const combined = `${fontName} ${fontFamily || ''}`;
  const bold = /bold|black|heavy|semibold|demi|700|800|900/i.test(combined);
  const italic = /italic|oblique|slant/i.test(combined);
  let cleanFamily = 'Calibri';
  if (/courier|mono|consolas|menlo|dejavu sans mono/i.test(combined)) {
    cleanFamily = 'Courier New';
  } else if (/times|georgia|garamond|cambria|palatino|serif/i.test(combined) && !/sans/i.test(combined)) {
    cleanFamily = 'Times New Roman';
  } else if (/arial|helvetica|verdana|tahoma|segoe|inter|roboto|open sans/i.test(combined)) {
    cleanFamily = 'Arial';
  }
  return { bold, italic, cleanFamily };
}

type PdfPageHandle = Awaited<
  ReturnType<Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>['getPage']>
>;
type BaseViewport = ReturnType<PdfPageHandle['getViewport']>;

interface TextDrawColorHint {
  x: number;
  y: number;
  colorHex: string;
}

export async function extractPageSpansAndVisuals(
  page: PdfPageHandle,
  baseViewport: BaseViewport
): Promise<{
  spans: ExtractedSpan[];
  visuals: PageVisualHints;
}> {
  const pageW = Math.max(100, baseViewport.width);
  const pageH = Math.max(100, baseViewport.height);
  const pageArea = pageW * pageH;

  const hRules: PageHorizontalRule[] = [];
  const vRules: PageVerticalRule[] = [];
  const bgRects: PageFilledRect[] = [];
  const rawImageBoxes: RectBox[] = [];
  const textColorHints: TextDrawColorHint[] = [];

  try {
    const opList = await page.getOperatorList();
    const OPS = pdfjsLib.OPS;
    const stack: {
      ctm: [number, number, number, number, number, number];
      fillHex: string;
      strokeHex: string;
    }[] = [];

    let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    let fillHex = '1E293B';
    let strokeHex = 'CBD5E1';
    let textMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
    let textLineMatrix: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

    const fillDrawOps = new Set<number>([
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);
    const strokeDrawOps = new Set<number>([
      OPS.stroke,
      OPS.closeStroke,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
    ]);

    for (let idx = 0; idx < opList.fnArray.length; idx++) {
      const fn = opList.fnArray[idx];
      const args = opList.argsArray[idx];

      if (fn === OPS.save) {
        stack.push({ ctm: [...ctm], fillHex, strokeHex });
      } else if (fn === OPS.restore) {
        const prev = stack.pop();
        if (prev) {
          ctm = prev.ctm;
          fillHex = prev.fillHex;
          strokeHex = prev.strokeHex;
        }
      } else if (fn === OPS.transform && Array.isArray(args) && args.length >= 6) {
        ctm = multiplyMatrix(ctm, args as number[]);
      } else if (fn === OPS.setFillRGBColor) {
        const hex = normalizeColorArgsToHex(args);
        if (hex) fillHex = hex;
      } else if (fn === OPS.setFillGray) {
        const hex = normalizeGrayArgToHex(args);
        if (hex) fillHex = hex;
      } else if (fn === OPS.setStrokeRGBColor) {
        const hex = normalizeColorArgsToHex(args);
        if (hex) strokeHex = hex;
      } else if (fn === OPS.setStrokeGray) {
        const hex = normalizeGrayArgToHex(args);
        if (hex) strokeHex = hex;
      } else if (fn === OPS.beginText) {
        textMatrix = [1, 0, 0, 1, 0, 0];
        textLineMatrix = [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.setTextMatrix && Array.isArray(args) && args.length >= 6) {
        const arr = args as [number, number, number, number, number, number];
        textMatrix = [...arr];
        textLineMatrix = [...arr];
      } else if (fn === OPS.moveText && Array.isArray(args) && args.length >= 2) {
        const [tx, ty] = args as number[];
        textLineMatrix = multiplyMatrix(textLineMatrix, [1, 0, 0, 1, tx, ty]);
        textMatrix = [...textLineMatrix];
      } else if (fn === OPS.showText) {
        const full = multiplyMatrix(baseViewport.transform, multiplyMatrix(ctm, textMatrix));
        textColorHints.push({
          x: full[4],
          y: full[5],
          colorHex: fillHex,
        });
      } else if (fn === OPS.constructPath && Array.isArray(args) && args.length >= 3) {
        const drawOp = Number(args[0]);
        const bbox = args[2] as ArrayLike<number> | null;
        if (bbox && bbox.length >= 4) {
          const viewMat = multiplyMatrix(baseViewport.transform, ctm);
          const box = transformBBox(viewMat, bbox[0], bbox[1], bbox[2], bbox[3]);
          const bw = box.x1 - box.x0;
          const bh = box.y1 - box.y0;
          if (bh <= 3.4 && bw >= 18) {
            hRules.push({
              y: (box.y0 + box.y1) / 2,
              x0: box.x0,
              x1: box.x1,
              colorHex: fillDrawOps.has(drawOp) ? fillHex : strokeHex,
            });
          } else if (bw <= 3.4 && bh >= 12) {
            vRules.push({
              x: (box.x0 + box.x1) / 2,
              y0: box.y0,
              y1: box.y1,
              colorHex: fillDrawOps.has(drawOp) ? fillHex : strokeHex,
            });
          } else if (bw >= 10 && bh >= 8 && bw * bh < pageArea * 0.86) {
            if (fillDrawOps.has(drawOp) && !isNearWhiteHex(fillHex)) {
              bgRects.push({ ...box, fillHex });
            }
            if (strokeDrawOps.has(drawOp)) {
              hRules.push({ y: box.y0, x0: box.x0, x1: box.x1, colorHex: strokeHex });
              hRules.push({ y: box.y1, x0: box.x0, x1: box.x1, colorHex: strokeHex });
              vRules.push({ x: box.x0, y0: box.y0, y1: box.y1, colorHex: strokeHex });
              vRules.push({ x: box.x1, y0: box.y0, y1: box.y1, colorHex: strokeHex });
            }
          }
        }
      } else if (
        fn === OPS.paintImageXObject ||
        fn === OPS.paintInlineImageXObject ||
        fn === OPS.paintImageXObjectRepeat
      ) {
        const viewMat = multiplyMatrix(baseViewport.transform, ctm);
        const box = transformBBox(viewMat, 0, 0, 1, 1);
        const bw = box.x1 - box.x0;
        const bh = box.y1 - box.y0;
        if (bw >= 22 && bh >= 22 && bw * bh < pageArea * 0.78) {
          const clamped: RectBox = {
            x0: Math.max(0, box.x0),
            y0: Math.max(0, box.y0),
            x1: Math.min(pageW, box.x1),
            y1: Math.min(pageH, box.y1),
          };
          if (clamped.x1 - clamped.x0 >= 22 && clamped.y1 - clamped.y0 >= 22) {
            rawImageBoxes.push(clamped);
          }
        }
      }
    }
  } catch {
    // Visual operator hints are best-effort; text layout still succeeds independently
  }

  // Deduplicate overlapping image boxes
  const imageBoxes: RectBox[] = [];
  for (const box of rawImageBoxes) {
    const duplicate = imageBoxes.some(
      (b) =>
        Math.abs(b.x0 - box.x0) < 6 &&
        Math.abs(b.y0 - box.y0) < 6 &&
        Math.abs(b.x1 - box.x1) < 6 &&
        Math.abs(b.y1 - box.y1) < 6
    );
    if (!duplicate) imageBoxes.push(box);
  }

  // Merge collinear horizontal & vertical rules (e.g. cell rectangles whose shared borders touch)
  const mergedHRules: PageHorizontalRule[] = [];
  for (const r of [...hRules].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
    const match = mergedHRules.find(
      (m) => Math.abs(m.y - r.y) <= 1.8 && r.x0 <= m.x1 + 3.5 && r.x1 >= m.x0 - 3.5
    );
    if (match) {
      match.x0 = Math.min(match.x0, r.x0);
      match.x1 = Math.max(match.x1, r.x1);
    } else {
      mergedHRules.push({ ...r });
    }
  }
  const mergedVRules: PageVerticalRule[] = [];
  for (const r of [...vRules].sort((a, b) => a.x - b.x || a.y0 - b.y0)) {
    const match = mergedVRules.find(
      (m) => Math.abs(m.x - r.x) <= 1.8 && r.y0 <= m.y1 + 3.5 && r.y1 >= m.y0 - 3.5
    );
    if (match) {
      match.y0 = Math.min(match.y0, r.y0);
      match.y1 = Math.max(match.y1, r.y1);
    } else {
      mergedVRules.push({ ...r });
    }
  }
  hRules.length = 0;
  hRules.push(...mergedHRules);
  vRules.length = 0;
  vRules.push(...mergedVRules);

  const textContent = await page.getTextContent();
  const stylesMap = (textContent.styles || {}) as Record<string, { fontFamily?: string }>;
  type PdfTextItem = Extract<(typeof textContent.items)[number], { str: string }>;

  const spans: ExtractedSpan[] = [];
  for (const item of textContent.items) {
    if (!('str' in item) || typeof item.str !== 'string') continue;
    if (item.str.trim().length === 0) continue;

    const rawItem = item as PdfTextItem;
    const mat = multiplyMatrix(baseViewport.transform, rawItem.transform || [12, 0, 0, 12, 0, 0]);
    const angle = Math.atan2(mat[1], mat[0]);
    // Skip steeply rotated/diagonal watermarks or vertical margin labels
    if (Math.abs(angle) > 0.35 && Math.abs(Math.abs(angle) - Math.PI) > 0.35) {
      continue;
    }

    const fontSize = Math.max(
      5.5,
      Math.min(96, Math.hypot(mat[2], mat[3]) || Math.hypot(mat[0], mat[1]) || rawItem.height || 11)
    );
    const x0 = mat[4];
    const ty = mat[5];
    const spanW = Math.max(0, rawItem.width || 0);
    const x1 = x0 + spanW;
    const topY = ty - fontSize * 0.85;
    const bottomY = ty + fontSize * 0.22;

    const styleInfo = stylesMap[rawItem.fontName];
    const { bold, italic, cleanFamily } = detectFontStyle(
      rawItem.fontName || '',
      styleInfo?.fontFamily
    );

    // Pick closest text color hint by baseline & X distance
    let colorHex: string | undefined;
    let bestDist = Infinity;
    for (const hint of textColorHints) {
      const dy = Math.abs(hint.y - ty);
      const dx = Math.abs(hint.x - x0);
      if (dy <= 3.5 && dx <= Math.max(24, spanW + 16)) {
        const dist = dy * 4 + dx;
        if (dist < bestDist) {
          bestDist = dist;
          colorHex = hint.colorHex;
        }
      }
    }

    // Check enclosing dark background rect to prevent white-on-white or dark-on-dark accidents
    const midX = (x0 + x1) / 2;
    const midY = (topY + bottomY) / 2;
    const enclosingBg = bgRects.find(
      (r) => midX >= r.x0 - 2 && midX <= r.x1 + 2 && midY >= r.y0 - 2 && midY <= r.y1 + 2
    );
    if (enclosingBg && hexLuminance(enclosingBg.fillHex) < 0.42) {
      if (!colorHex || hexLuminance(colorHex) < 0.45) {
        colorHex = 'FFFFFF';
      }
    } else if (colorHex && isNearWhiteHex(colorHex)) {
      colorHex = '1E293B';
    }

    spans.push({
      x0,
      x1,
      topY,
      bottomY,
      ty,
      width: spanW,
      text: rawItem.str,
      fontSize,
      fontFamily: cleanFamily,
      bold,
      italic,
      colorHex,
    });
  }

  return {
    spans,
    visuals: { hRules, vRules, bgRects, imageBoxes },
  };
}

export function clusterSpansIntoVisualLines(spans: ExtractedSpan[]): ExtractedLine[] {
  const sorted = [...spans].sort((a, b) => a.ty - b.ty || a.x0 - b.x0);
  const lines: ExtractedLine[] = [];

  for (const span of sorted) {
    const yTol = Math.max(2.6, span.fontSize * 0.4);
    let target: ExtractedLine | undefined;
    let bestDy = Infinity;

    for (const line of lines) {
      const dy = Math.abs(line.ty - span.ty);
      if (dy <= yTol && dy < bestDy) {
        bestDy = dy;
        target = line;
      }
    }

    if (!target) {
      lines.push({
        ty: span.ty,
        topY: span.topY,
        bottomY: span.bottomY,
        minX: span.x0,
        maxX: span.x1,
        avgFontSize: span.fontSize,
        spans: [span],
      });
    } else {
      target.spans.push(span);
      target.topY = Math.min(target.topY, span.topY);
      target.bottomY = Math.max(target.bottomY, span.bottomY);
      target.minX = Math.min(target.minX, span.x0);
      target.maxX = Math.max(target.maxX, span.x1);
      target.ty = target.spans.reduce((acc, s) => acc + s.ty, 0) / target.spans.length;
      target.avgFontSize =
        target.spans.reduce((acc, s) => acc + s.fontSize, 0) / target.spans.length;
    }
  }

  for (const line of lines) {
    line.spans.sort((a, b) => a.x0 - b.x0);
  }
  lines.sort((a, b) => a.ty - b.ty || a.minX - b.minX);
  return lines;
}

function getBounds(spans: ExtractedSpan[]): RectBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const s of spans) {
    if (s.x0 < x0) x0 = s.x0;
    if (s.topY < y0) y0 = s.topY;
    if (s.x1 > x1) x1 = s.x1;
    if (s.bottomY > y1) y1 = s.bottomY;
  }
  return { x0, y0, x1, y1 };
}

function findEnclosingBgHex(region: RectBox, visuals: PageVisualHints): string | undefined {
  const regionW = Math.max(1, region.x1 - region.x0);
  const regionH = Math.max(1, region.y1 - region.y0);
  const centerX = (region.x0 + region.x1) / 2;
  const centerY = (region.y0 + region.y1) / 2;

  for (const rect of visuals.bgRects) {
    if (
      centerX >= rect.x0 - 4 &&
      centerX <= rect.x1 + 4 &&
      centerY >= rect.y0 - 4 &&
      centerY <= rect.y1 + 4
    ) {
      const rw = rect.x1 - rect.x0;
      const rh = rect.y1 - rect.y0;
      // Solo aplicar sombreado si el rectángulo se ajusta al bloque o banda (evitar fondo global)
      if (rw >= regionW * 0.7 && rh <= Math.max(regionH * 2.2, 60)) {
        return rect.fillHex;
      }
    }
  }
  return undefined;
}

function splitHorizontalBands(
  spans: ExtractedSpan[],
  visuals: PageVisualHints
): ExtractedSpan[][] {
  if (spans.length <= 1) return [spans];

  const sorted = [...spans].sort((a, b) => a.topY - b.topY);
  const intervals: { top: number; bottom: number; maxFs: number; items: ExtractedSpan[] }[] = [];

  for (const s of sorted) {
    // Ligero recorte vertical para no unir líneas consecutivas con interlineado justo
    const pad = Math.min(2, s.fontSize * 0.09);
    const sTop = s.topY + pad;
    const sBot = Math.max(sTop + 1, s.bottomY - pad);

    const last = intervals[intervals.length - 1];
    if (!last || sTop > last.bottom) {
      intervals.push({ top: sTop, bottom: sBot, maxFs: s.fontSize, items: [s] });
    } else {
      last.bottom = Math.max(last.bottom, sBot);
      last.maxFs = Math.max(last.maxFs, s.fontSize);
      last.items.push(s);
    }
  }

  if (intervals.length <= 1) return [spans];

  const bands: ExtractedSpan[][] = [];
  let current: ExtractedSpan[] = [...intervals[0].items];
  let currentBottom = intervals[0].bottom;
  let currentFs = intervals[0].maxFs;

  for (let i = 1; i < intervals.length; i++) {
    const next = intervals[i];
    const gap = next.top - currentBottom;
    const localFs = Math.max(currentFs, next.maxFs);
    const bandBounds = getBounds(current);
    const nextBounds = getBounds(next.items);
    const insideTableVRule = visuals.vRules.some(
      (r) =>
        r.y0 <= currentBottom + 2 &&
        r.y1 >= next.top - 2 &&
        r.x >= Math.min(bandBounds.x0, nextBounds.x0) - 6 &&
        r.x <= Math.max(bandBounds.x1, nextBounds.x1) + 6
    );

    const hasSeparatorRule = visuals.hRules.some(
      (r) =>
        r.y >= currentBottom - 2 &&
        r.y <= next.top + 2 &&
        r.x1 - r.x0 >= (bandBounds.x1 - bandBounds.x0) * 0.45
    );

    const bothLookTabularRows =
      !hasSeparatorRule &&
      gap < localFs * 2.1 &&
      projectXColumns(current.slice(-12), Math.max(12, localFs * 1.3)).length >= 2 &&
      projectXColumns(next.items, Math.max(12, localFs * 1.3)).length >= 2;

    const shouldSplit =
      !insideTableVRule &&
      !bothLookTabularRows &&
      (gap >= Math.max(10.5, localFs * 0.92) || (hasSeparatorRule && gap >= 2.5));

    if (shouldSplit) {
      bands.push(current);
      current = [...next.items];
      currentBottom = next.bottom;
      currentFs = next.maxFs;
    } else {
      current.push(...next.items);
      currentBottom = Math.max(currentBottom, next.bottom);
      currentFs = Math.max(currentFs, next.maxFs);
    }
  }
  bands.push(current);
  return bands;
}

interface XInterval {
  x0: number;
  x1: number;
  items: ExtractedSpan[];
}

function projectXColumns(spans: ExtractedSpan[], minGapPt: number): XInterval[] {
  const sorted = [...spans].sort((a, b) => a.x0 - b.x0);
  const cols: XInterval[] = [];

  for (const s of sorted) {
    const last = cols[cols.length - 1];
    if (!last || s.x0 - last.x1 >= minGapPt) {
      cols.push({ x0: s.x0, x1: s.x1, items: [s] });
    } else {
      last.x1 = Math.max(last.x1, s.x1);
      last.items.push(s);
    }
  }
  return cols;
}

function computeCellAlignment(
  lines: ExtractedLine[],
  colX0: number,
  colX1: number
): 'left' | 'center' | 'right' {
  if (lines.length === 0) return 'left';
  const colW = Math.max(12, colX1 - colX0);
  const leftMargins = lines.map((l) => l.minX - colX0);
  const rightMargins = lines.map((l) => colX1 - l.maxX);
  const avgLeft = leftMargins.reduce((a, b) => a + b, 0) / leftMargins.length;
  const avgRight = rightMargins.reduce((a, b) => a + b, 0) / rightMargins.length;

  const isMostlyNumbers = lines.every((l) =>
    /^[\s$€£+-]*[\d.,%()/-]+$/.test(l.spans.map((s) => s.text).join(' ').trim())
  );

  if ((isMostlyNumbers || avgLeft > colW * 0.25) && avgRight <= Math.max(10, avgLeft * 0.35)) {
    return 'right';
  }
  if (
    colW > 36 &&
    Math.abs(avgLeft - avgRight) <= 10 &&
    avgLeft >= 10 &&
    lines.every((l) => l.maxX - l.minX < colW * 0.8)
  ) {
    return 'center';
  }
  return 'left';
}

function tryBuildTableNode(
  spans: ExtractedSpan[],
  region: RectBox,
  visuals: PageVisualHints,
  colIntervals: XInterval[]
): Extract<PageLayoutNode, { kind: 'table' }> | null {
  if (colIntervals.length < 2 || colIntervals.length > 10) return null;

  const lines = clusterSpansIntoVisualLines(spans);
  if (lines.length < 2) return null;

  // Mapear qué columnas ocupa cada línea visual
  const rowColOccupancy = lines.map((line) => {
    const colHits = Array.from({ length: colIntervals.length }, (): ExtractedSpan[] => []);
    for (const s of line.spans) {
      const midX = (s.x0 + s.x1) / 2;
      let bestCol = 0;
      let bestDist = Infinity;
      for (let c = 0; c < colIntervals.length; c++) {
        const ci = colIntervals[c];
        if (midX >= ci.x0 - 2 && midX <= ci.x1 + 2) {
          bestCol = c;
          bestDist = 0;
          break;
        }
        const d = Math.min(Math.abs(midX - ci.x0), Math.abs(midX - ci.x1));
        if (d < bestDist) {
          bestDist = d;
          bestCol = c;
        }
      }
      colHits[bestCol].push(s);
    }
    const occupiedCount = colHits.filter((arr) => arr.length > 0).length;
    return { line, colHits, occupiedCount };
  });

  const multiColLines = rowColOccupancy.filter((r) => r.occupiedCount >= 2).length;

  // Reglas vectoriales del PDF en la zona de la tabla
  const rulesInsideH = visuals.hRules.filter(
    (r) => r.y >= region.y0 - 4 && r.y <= region.y1 + 4 && r.x1 >= region.x0 && r.x0 <= region.x1
  );
  const rulesInsideV = visuals.vRules.filter(
    (r) => r.x >= region.x0 - 4 && r.x <= region.x1 + 4 && r.y1 >= region.y0 && r.y0 <= region.y1
  );
  const hasExplicitGridRules = rulesInsideH.length >= 2 || rulesInsideV.length >= 1;

  // Distinguir entre tabla real y artículos de 2 columnas con párrafos independientes:
  const avgCharsPerColInterval =
    colIntervals.reduce(
      (sum, c) => sum + c.items.reduce((t, s) => t + s.text.length, 0),
      0
    ) / colIntervals.length;

  if (!hasExplicitGridRules && multiColLines / lines.length < 0.55) {
    return null;
  }
  if (!hasExplicitGridRules) {
    // 1) En una tabla sin bordes, las columnas comparten la misma línea base horizontal (desfase <= 2.2pt)
    const baselineDiffs: number[] = [];
    for (const r of rowColOccupancy) {
      const colYs = r.colHits
        .filter((arr) => arr.length > 0)
        .map((arr) => arr.reduce((s, sp) => s + sp.ty, 0) / arr.length);
      if (colYs.length >= 2) {
        baselineDiffs.push(Math.max(...colYs) - Math.min(...colYs));
      }
    }
    if (baselineDiffs.length > 0) {
      baselineDiffs.sort((a, b) => a - b);
      const medianBaselineDiff = baselineDiffs[Math.floor(baselineDiffs.length / 2)];
      if (medianBaselineDiff > 2.2) {
        return null;
      }
    }

    // 2) En diseños de 2 columnas sin bordes ni sombreado, si ambas columnas son texto narrativo continuo, preservar orden columna por columna
    const hasShadingInside = visuals.bgRects.some(
      (bg) => bg.y1 >= region.y0 - 2 && bg.y0 <= region.y1 + 2 && bg.x1 >= region.x0 && bg.x0 <= region.x1
    );
    if (!hasShadingInside && colIntervals.length === 2) {
      if (lines.length >= 8 && avgCharsPerColInterval > 260) {
        return null;
      }
      const colStats = colIntervals.map((ci) => {
        const cLines = clusterSpansIntoVisualLines(ci.items);
        const lineTexts = cLines.map((l) => l.spans.map((s) => s.text).join(' ').trim());
        const avgChars =
          lineTexts.reduce((sum, t) => sum + t.length, 0) / Math.max(1, lineTexts.length);
        const avgWords =
          lineTexts.reduce((sum, t) => sum + t.split(/\s+/).filter(Boolean).length, 0) /
          Math.max(1, lineTexts.length);
        const numericCount = lineTexts.filter((t) =>
          /^(?:[$€£]?\s*-?\d[\d.,]*\s*%?|\d{1,4}[/-]\d{1,2}(?:[/-]\d{2,4})?)$/.test(t)
        ).length;
        return {
          lineCount: cLines.length,
          avgChars,
          avgWords,
          numericRatio: numericCount / Math.max(1, cLines.length),
        };
      });
      const bothLongProse = colStats.every(
        (st) => st.lineCount >= 2 && st.avgChars >= 22 && st.avgWords >= 3.5 && st.numericRatio < 0.25
      );
      if (bothLongProse) {
        return null;
      }
    }
  }

  // Agrupar líneas que pertenecen a una misma fila lógica (si una celda envolvió texto sin iniciar nueva fila en otras columnas)
  const logicalRows: { lines: ExtractedLine[]; colHits: ExtractedSpan[][] }[] = [];
  for (const entry of rowColOccupancy) {
    const prev = logicalRows[logicalRows.length - 1];
    const hasRuleBetween =
      prev &&
      rulesInsideH.some(
        (r) =>
          r.y >= prev.lines[prev.lines.length - 1].bottomY - 2 &&
          r.y <= entry.line.topY + 2
      );

    const prevCols = prev
      ? new Set(prev.colHits.map((arr, idx) => (arr.length > 0 ? idx : -1)).filter((x) => x >= 0))
      : new Set<number>();
    const currCols = entry.colHits
      .map((arr, idx) => (arr.length > 0 ? idx : -1))
      .filter((x) => x >= 0);

    const verticalGap = prev
      ? entry.line.ty - prev.lines[prev.lines.length - 1].ty
      : Infinity;

    const looksLikeWrappedCellContinuation =
      Boolean(prev) &&
      !hasRuleBetween &&
      entry.occupiedCount === 1 &&
      currCols.every((c) => prevCols.has(c)) &&
      verticalGap > 0 &&
      verticalGap <= entry.line.avgFontSize * 1.45;

    if (looksLikeWrappedCellContinuation && prev) {
      prev.lines.push(entry.line);
      for (let c = 0; c < colIntervals.length; c++) {
        if (entry.colHits[c].length > 0) {
          prev.colHits[c].push(...entry.colHits[c]);
        }
      }
    } else {
      logicalRows.push({
        lines: [entry.line],
        colHits: entry.colHits.map((arr) => [...arr]),
      });
    }
  }

  if (logicalRows.length < 2) return null;

  // Calcular anchos proporcionales por columna
  const rawWidths = colIntervals.map((c, idx) => {
    const leftEdge = idx === 0 ? c.x0 : (colIntervals[idx - 1].x1 + c.x0) / 2;
    const rightEdge =
      idx === colIntervals.length - 1 ? c.x1 : (c.x1 + colIntervals[idx + 1].x0) / 2;
    return Math.max(36, rightEdge - leftEdge);
  });

  const rows: TableRowBlock[] = logicalRows.map((row, rIdx) => {
    const rowTop = Math.min(...row.lines.map((l) => l.topY));
    const rowBot = Math.max(...row.lines.map((l) => l.bottomY));
    const rowMidY = (rowTop + rowBot) / 2;

    const rowBg = visuals.bgRects.find(
      (bg) =>
        rowMidY >= bg.y0 - 2 &&
        rowMidY <= bg.y1 + 2 &&
        bg.x1 - bg.x0 >= (region.x1 - region.x0) * 0.45
    )?.fillHex;

    const cells: TableCellBlock[] = row.colHits.map((cellSpans, cIdx) => {
      const ci = colIntervals[cIdx];
      const cellLines = clusterSpansIntoVisualLines(cellSpans);
      const cellBg =
        rowBg ||
        visuals.bgRects.find((bg) => {
          const cx = (ci.x0 + ci.x1) / 2;
          return cx >= bg.x0 - 2 && cx <= bg.x1 + 2 && rowMidY >= bg.y0 - 2 && rowMidY <= bg.y1 + 2;
        })?.fillHex;

      return {
        spans: cellSpans,
        lines: cellLines,
        bgHex: cellBg,
        align: computeCellAlignment(cellLines, ci.x0, ci.x1),
      };
    });

    const isBoldRow =
      rIdx === 0 &&
      row.colHits.flat().length > 0 &&
      row.colHits.flat().filter((s) => s.bold).length >= row.colHits.flat().length * 0.6;

    return {
      isHeader: rIdx === 0 && (Boolean(rowBg) || isBoldRow || hasExplicitGridRules),
      cells,
    };
  });

  return {
    kind: 'table',
    region,
    colWidthsPt: rawWidths,
    hasBorders: hasExplicitGridRules || logicalRows.length >= 3,
    rows,
  };
}

function layoutRegionRecursive(
  spans: ExtractedSpan[],
  region: RectBox,
  visuals: PageVisualHints,
  depth = 0
): PageLayoutNode[] {
  if (spans.length === 0) return [];
  if (depth >= 6) {
    return [
      {
        kind: 'prose',
        region,
        lines: clusterSpansIntoVisualLines(spans),
        bgHex: findEnclosingBgHex(region, visuals),
      },
    ];
  }

  // 1. Dividir primero por franjas horizontales claras (encabezado / cuerpo / pie)
  const hBands = splitHorizontalBands(spans, visuals);
  if (hBands.length > 1) {
    const out: PageLayoutNode[] = [];
    for (const bandSpans of hBands) {
      const bandBox = getBounds(bandSpans);
      out.push(...layoutRegionRecursive(bandSpans, bandBox, visuals, depth + 1));
    }
    return out;
  }

  // 2. Dentro de la franja horizontal, detectar columnas verticales por proyección X
  const sizes = spans.map((s) => s.fontSize).sort((a, b) => a - b);
  const medianSize = sizes[Math.floor(sizes.length / 2)] || 11;
  const colGapThreshold = Math.max(12, medianSize * 1.32);
  const colIntervals = projectXColumns(spans, colGapThreshold);

  if (colIntervals.length >= 2) {
    // ¿Es una tabla alineada por filas?
    const tableNode = tryBuildTableNode(spans, region, visuals, colIntervals);
    if (tableNode) {
      return [tableNode];
    }

    // Si son <= 4 columnas independientes (p. ej. 2 columnas de artículo, barra lateral + contenido, encabezado izquierda/derecha)
    if (colIntervals.length <= 4) {
      const colWidthsPt = colIntervals.map((c, idx) => {
        const left = idx === 0 ? c.x0 : (colIntervals[idx - 1].x1 + c.x0) / 2;
        const right = idx === colIntervals.length - 1 ? c.x1 : (c.x1 + colIntervals[idx + 1].x0) / 2;
        return Math.max(40, right - left);
      });

      const columns = colIntervals.map((col, idx) => {
        const left = idx === 0 ? col.x0 : (colIntervals[idx - 1].x1 + col.x0) / 2;
        const right =
          idx === colIntervals.length - 1 ? col.x1 : (col.x1 + colIntervals[idx + 1].x0) / 2;
        const colRect: RectBox = {
          x0: left,
          y0: region.y0,
          x1: right,
          y1: region.y1,
        };
        return layoutRegionRecursive(col.items, colRect, visuals, depth + 1);
      });

      return [
        {
          kind: 'columns',
          region,
          colWidthsPt,
          columns,
        },
      ];
    }
  }

  // 3. Bloque de prosa de una sola columna
  return [
    {
      kind: 'prose',
      region,
      lines: clusterSpansIntoVisualLines(spans),
      bgHex: findEnclosingBgHex(region, visuals),
    },
  ];
}

export function buildStructuredPageLayout(
  spans: ExtractedSpan[],
  visuals: PageVisualHints,
  pageWidthPt: number,
  pageHeightPt: number
): {
  nodes: PageLayoutNode[];
  marginsPt: { top: number; right: number; bottom: number; left: number };
  standaloneImages: RectBox[];
} {
  if (spans.length === 0) {
    return {
      nodes: [],
      marginsPt: { top: 54, right: 54, bottom: 54, left: 54 },
      standaloneImages: [],
    };
  }

  const bounds = getBounds(spans);
  const clampMargin = (val: number, min = 24, max = 86) => Math.max(min, Math.min(max, val));

  const marginsPt = {
    left: clampMargin(bounds.x0),
    right: clampMargin(pageWidthPt - bounds.x1),
    top: clampMargin(bounds.y0),
    bottom: clampMargin(pageHeightPt - bounds.y1),
  };

  // Filtrar imágenes independientes que no tengan texto superpuesto encima (logos, gráficas, fotos, firmas)
  const standaloneImages = visuals.imageBoxes
    .filter((box) => {
      const overlappingText = spans.filter((s) => {
        const sx = (s.x0 + s.x1) / 2;
        const sy = (s.topY + s.bottomY) / 2;
        return sx >= box.x0 && sx <= box.x1 && sy >= box.y0 && sy <= box.y1;
      });
      return overlappingText.length <= 1;
    })
    .slice(0, 8);

  const nodes = layoutRegionRecursive(spans, bounds, visuals, 0);

  // Insertar imágenes independientes ordenadas por coordenada vertical Y
  if (standaloneImages.length > 0) {
    const merged: { y: number; node: PageLayoutNode }[] = nodes.map((n) => ({
      y: n.region.y0,
      node: n,
    }));
    for (const imgBox of standaloneImages) {
      // Evitar insertar imagen duplicada encima de una columna si ya cabe arriba/abajo
      merged.push({
        y: imgBox.y0,
        node: {
          kind: 'image',
          region: imgBox,
          box: imgBox,
        },
      });
    }
    merged.sort((a, b) => a.y - b.y);
    return {
      nodes: merged.map((m) => m.node),
      marginsPt,
      standaloneImages,
    };
  }

  return { nodes, marginsPt, standaloneImages };
}
