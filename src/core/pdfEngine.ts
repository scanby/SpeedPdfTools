import { pdfjsLib } from './pdfjsSetup';
import JSZip from 'jszip';
import { PDFDocument, PDFPage, PageSizes, degrees } from 'pdf-lib';
import {
  CompressionSettings,
  ImageExportSettings,
  ImageToPdfSettings,
  OrganizerPageItem,
  OrganizerSourceFile,
  ProgressState,
  QueueFileItem,
} from '../types/speedpdf';
import { parsePageRange, stripExtension, yieldToMain } from './formatters';

function normalizeRotation(angle = 0): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

export function applyPdfPageRotation(page: PDFPage, extraDegrees = 0): void {
  const norm = normalizeRotation(extraDegrees);
  if (norm === 0) return;
  const current = page.getRotation().angle;
  page.setRotation(degrees((current + norm) % 360));
}

function clearMetadata(pdfDoc: PDFDocument): void {
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setKeywords([]);
  pdfDoc.setProducer('SPEED.PDF Local');
  pdfDoc.setCreator('SPEED.PDF');
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('No se pudo codificar el lienzo de página.'));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export async function inspectPdfFile(file: File): Promise<{
  pageCount: number;
  thumbnailUrl?: string;
}> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  try {
    const pageCount = pdf.numPages;
    let thumbnailUrl: string | undefined;

    if (pageCount > 0) {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const targetWidth = 140;
      const scale = targetWidth / viewport.width;
      const scaled = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(scaled.width));
      canvas.height = Math.max(1, Math.floor(scaled.height));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        await page.render({ canvasContext: ctx, viewport: scaled, canvas }).promise;
        thumbnailUrl = canvas.toDataURL('image/jpeg', 0.72);
      }
      releaseCanvas(canvas);
      page.cleanup();
    }

    return { pageCount, thumbnailUrl };
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function inspectImageFile(file: File): Promise<{ thumbnailUrl: string }> {
  const url = URL.createObjectURL(file);
  return { thumbnailUrl: url };
}

export async function compressPdf(
  file: File,
  settings: CompressionSettings,
  onProgress: (state: ProgressState) => void,
  extraRotation = 0
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const rotNorm = normalizeRotation(extraRotation);

  if (settings.structuralOnly) {
    onProgress({
      active: true,
      percent: 20,
      stage: 'Analizando estructura de objetos PDF...',
    });

    const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const outDoc = await PDFDocument.create();
    const totalPages = srcDoc.getPageCount();
    const indices = Array.from({ length: totalPages }, (_, i) => i);

    onProgress({
      active: true,
      percent: 55,
      stage: 'Reconstruyendo flujos de objetos comprimidos...',
      currentPage: totalPages,
      totalPages,
    });

    const copied = await outDoc.copyPages(srcDoc, indices);
    for (const p of copied) {
      applyPdfPageRotation(p, rotNorm);
      outDoc.addPage(p);
    }

    if (settings.stripMetadata) {
      clearMetadata(outDoc);
    }

    const compressedBytes = await outDoc.save({
      useObjectStreams: true,
      addDefaultPage: false,
      objectsPerTick: 60,
    });

    onProgress({
      active: false,
      percent: 100,
      stage: 'Completado',
      currentPage: totalPages,
      totalPages,
    });

    return {
      blob: new Blob([new Uint8Array(compressedBytes)], { type: 'application/pdf' }),
      fileName: `${stripExtension(file.name)}_comprimido.pdf`,
      pageCount: totalPages,
    };
  }

  // Visual chunked recompression at target DPI & JPEG quality
  const loadingTask = pdfjsLib.getDocument({ data: sourceBytes });
  const srcPdf = await loadingTask.promise;
  const outDoc = await PDFDocument.create();
  const totalPages = srcPdf.numPages;

  try {
    const scale = settings.dpi / 72;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / totalPages) * 90) + 5,
        stage: `Comprimiendo página ${pageNum} de ${totalPages} (${settings.dpi} DPI)...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await srcPdf.getPage(pageNum);
      const effectiveRotation = (page.rotate + rotNorm) % 360;
      const baseViewport = page.getViewport({ scale: 1, rotation: effectiveRotation });
      const renderViewport = page.getViewport({ scale, rotation: effectiveRotation });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(renderViewport.width));
      canvas.height = Math.max(1, Math.floor(renderViewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });

      if (!ctx) {
        throw new Error('Contexto gráfico 2D no disponible en el navegador.');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport: renderViewport, canvas }).promise;
      const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', settings.jpegQuality);
      const jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());

      releaseCanvas(canvas);
      page.cleanup();

      const embedded = await outDoc.embedJpg(jpegBytes);
      const outPage = outDoc.addPage([baseViewport.width, baseViewport.height]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: baseViewport.width,
        height: baseViewport.height,
      });

      await yieldToMain();
    }

    if (settings.stripMetadata) {
      clearMetadata(outDoc);
    }

    onProgress({
      active: true,
      percent: 96,
      stage: 'Empaquetando PDF local optimizado...',
      currentPage: totalPages,
      totalPages,
    });

    const outBytes = await outDoc.save({ useObjectStreams: true });

    onProgress({
      active: false,
      percent: 100,
      stage: 'Completado',
      currentPage: totalPages,
      totalPages,
    });

    return {
      blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
      fileName: `${stripExtension(file.name)}_comprimido.pdf`,
      pageCount: totalPages,
    };
  } finally {
    await srcPdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function mergePdfs(
  items: QueueFileItem[],
  stripMetadata: boolean,
  outputName: string,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  if (items.length < 2) {
    throw new Error('Selecciona al menos 2 archivos PDF para unirlos.');
  }

  const outDoc = await PDFDocument.create();
  let totalCopiedPages = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress({
      active: true,
      percent: Math.round((i / items.length) * 85) + 5,
      stage: `Integrando ${item.name} (${i + 1}/${items.length})...`,
      currentPage: i + 1,
      totalPages: items.length,
    });

    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = parsePageRange(item.pageRange, srcDoc.getPageCount());
    const pages = await outDoc.copyPages(srcDoc, indices);
    const rot = normalizeRotation(item.rotation ?? 0);

    for (const p of pages) {
      applyPdfPageRotation(p, rot);
      outDoc.addPage(p);
      totalCopiedPages++;
    }

    await yieldToMain();
  }

  if (stripMetadata) {
    clearMetadata(outDoc);
  }

  onProgress({
    active: true,
    percent: 95,
    stage: 'Generando documento unificado...',
  });

  const mergedBytes = await outDoc.save({ useObjectStreams: true });
  const cleanName = stripExtension(outputName.trim() || 'documentos_unidos');

  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
  });

  return {
    blob: new Blob([new Uint8Array(mergedBytes)], { type: 'application/pdf' }),
    fileName: `${cleanName}.pdf`,
    pageCount: totalCopiedPages,
  };
}

export async function rotatePdf(
  file: File,
  extraRotation: number,
  pageRange: string,
  stripMetadata: boolean,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number; appliedDegrees: number }> {
  const rotNorm = normalizeRotation(extraRotation) || 90;

  onProgress({
    active: true,
    percent: 25,
    stage: `Aplicando rotación de ${rotNorm}° a ${file.name}...`,
  });

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const pdfDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
  const totalPages = pdfDoc.getPageCount();
  const targetIndices = new Set(parsePageRange(pageRange, totalPages));

  for (let i = 0; i < totalPages; i++) {
    if (targetIndices.has(i)) {
      applyPdfPageRotation(pdfDoc.getPage(i), rotNorm);
    }
  }

  if (stripMetadata) {
    clearMetadata(pdfDoc);
  }

  onProgress({
    active: true,
    percent: 85,
    stage: 'Guardando PDF con orientación corregida...',
    currentPage: totalPages,
    totalPages,
  });

  const outBytes = await pdfDoc.save({ useObjectStreams: true });
  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
    currentPage: totalPages,
    totalPages,
  });

  return {
    blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
    fileName: `${stripExtension(file.name)}_girado_${rotNorm}.pdf`,
    pageCount: totalPages,
    appliedDegrees: rotNorm,
  };
}

export async function pdfToImages(
  file: File,
  settings: ImageExportSettings,
  onProgress: (state: ProgressState) => void,
  extraRotation = 0
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const rotNorm = normalizeRotation(extraRotation);
  const loadingTask = pdfjsLib.getDocument({ data: sourceBytes });
  const pdf = await loadingTask.promise;
  const totalPages = pdf.numPages;
  const ext = settings.format === 'png' ? 'png' : 'jpg';
  const mimeType = settings.format === 'png' ? 'image/png' : 'image/jpeg';
  const baseName = stripExtension(file.name);

  try {
    const scale = settings.dpi / 72;

    if (totalPages === 1 && !settings.bundleAsZip) {
      onProgress({
        active: true,
        percent: 45,
        stage: `Renderizando página 1 a ${settings.dpi} DPI...`,
        currentPage: 1,
        totalPages: 1,
      });

      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotNorm) % 360 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: settings.format === 'png' });

      if (!ctx) throw new Error('Contexto gráfico no disponible.');
      if (settings.format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const imgBlob = await canvasToBlob(
        canvas,
        mimeType,
        settings.format === 'jpeg' ? settings.quality : undefined
      );
      releaseCanvas(canvas);
      page.cleanup();

      onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: 1, totalPages: 1 });
      return {
        blob: imgBlob,
        fileName: `${baseName}_pagina_1.${ext}`,
        pageCount: 1,
      };
    }

    const zip = new JSZip();

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / totalPages) * 85) + 5,
        stage: `Exportando página ${pageNum} de ${totalPages} (${ext.toUpperCase()})...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale, rotation: (page.rotate + rotNorm) % 360 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: settings.format === 'png' });

      if (!ctx) throw new Error('Contexto gráfico no disponible.');
      if (settings.format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const imgBlob = await canvasToBlob(
        canvas,
        mimeType,
        settings.format === 'jpeg' ? settings.quality : undefined
      );

      releaseCanvas(canvas);
      page.cleanup();

      const padded = String(pageNum).padStart(3, '0');
      zip.file(`${baseName}_pag_${padded}.${ext}`, imgBlob);
      await yieldToMain();
    }

    onProgress({
      active: true,
      percent: 94,
      stage: 'Comprimiendo paquete ZIP local...',
      currentPage: totalPages,
      totalPages,
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: totalPages, totalPages });

    return {
      blob: zipBlob,
      fileName: `${baseName}_imagenes_${settings.dpi}dpi.zip`,
      pageCount: totalPages,
    };
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

async function normalizeImageBytesForPdf(
  file: File,
  jpegQuality: number,
  extraRotation = 0
): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg'; width: number; height: number }> {
  const rotNorm = normalizeRotation(extraRotation);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`No se pudo decodificar la imagen ${file.name}.`));
      el.src = url;
    });

    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (rotNorm === 0 && isPng && jpegQuality >= 0.92) {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: 'png',
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    }

    if (rotNorm === 0 && file.type === 'image/jpeg' && jpegQuality >= 0.92) {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: 'jpg',
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    }

    const swapDims = rotNorm === 90 || rotNorm === 270;
    const outW = swapDims ? img.naturalHeight : img.naturalWidth;
    const outH = swapDims ? img.naturalWidth : img.naturalHeight;

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Contexto gráfico no disponible.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((rotNorm * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
    releaseCanvas(canvas);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      kind: 'jpg',
      width: outW,
      height: outH,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imagesToPdf(
  files: File[],
  settings: ImageToPdfSettings,
  onProgress: (state: ProgressState) => void,
  rotations: number[] = []
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  if (files.length === 0) {
    throw new Error('Agrega al menos una imagen JPG o PNG.');
  }

  const outDoc = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress({
      active: true,
      percent: Math.round((i / files.length) * 85) + 5,
      stage: `Procesando imagen ${i + 1} de ${files.length}: ${file.name}`,
      currentPage: i + 1,
      totalPages: files.length,
    });

    const normalized = await normalizeImageBytesForPdf(
      file,
      settings.jpegQuality,
      rotations[i] ?? 0
    );
    const embedded =
      normalized.kind === 'png'
        ? await outDoc.embedPng(normalized.bytes)
        : await outDoc.embedJpg(normalized.bytes);

    let pageW: number;
    let pageH: number;

    if (settings.pageSize === 'fit') {
      pageW = normalized.width * 0.75 + settings.marginPt * 2;
      pageH = normalized.height * 0.75 + settings.marginPt * 2;
    } else {
      const base = settings.pageSize === 'letter' ? PageSizes.Letter : PageSizes.A4;
      const isImgLandscape = normalized.width > normalized.height;
      const useLandscape =
        settings.orientation === 'landscape' ||
        (settings.orientation === 'auto' && isImgLandscape);

      pageW = useLandscape ? base[1] : base[0];
      pageH = useLandscape ? base[0] : base[1];
    }

    const page = outDoc.addPage([pageW, pageH]);
    const availW = Math.max(20, pageW - settings.marginPt * 2);
    const availH = Math.max(20, pageH - settings.marginPt * 2);
    const ratio = Math.min(availW / normalized.width, availH / normalized.height);
    const drawW = normalized.width * ratio;
    const drawH = normalized.height * ratio;

    page.drawImage(embedded, {
      x: (pageW - drawW) / 2,
      y: (pageH - drawH) / 2,
      width: drawW,
      height: drawH,
    });

    await yieldToMain();
  }

  clearMetadata(outDoc);
  const outBytes = await outDoc.save({ useObjectStreams: true });
  const baseName = files.length === 1 ? stripExtension(files[0].name) : 'imagenes_convertidas';

  onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: files.length, totalPages: files.length });

  return {
    blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
    fileName: `${baseName}.pdf`,
    pageCount: files.length,
  };
}

export async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;
  try {
    return pdf.numPages;
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function renderPdfAllPageThumbnails(
  file: File,
  onPageRendered: (pageNumber: number, thumbnailUrl: string) => void,
  isCancelled?: () => boolean
): Promise<number> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  try {
    const totalPages = pdf.numPages;
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (isCancelled?.()) break;

      const page = await pdf.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const targetWidth = 180;
      const scale = targetWidth / Math.max(1, baseViewport.width);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.74);
        if (!isCancelled?.()) {
          onPageRendered(pageNum, dataUrl);
        }
      }
      releaseCanvas(canvas);
      page.cleanup();
      await yieldToMain();
    }
    return totalPages;
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function assembleOrganizedPdf(
  sourceFiles: OrganizerSourceFile[],
  pages: OrganizerPageItem[],
  outputName: string,
  stripMetadata: boolean,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  if (pages.length === 0) {
    throw new Error('Debe quedar al menos 1 página para generar el PDF ordenado.');
  }

  const fileMap = new Map<string, OrganizerSourceFile>();
  for (const sf of sourceFiles) {
    fileMap.set(sf.id, sf);
  }

  const loadedDocs = new Map<string, PDFDocument>();
  const uniqueFileIds = Array.from(new Set(pages.map((p) => p.sourceFileId)));

  for (let i = 0; i < uniqueFileIds.length; i++) {
    const fileId = uniqueFileIds[i];
    const source = fileMap.get(fileId);
    if (!source) {
      throw new Error('No se encontró uno de los archivos PDF de origen.');
    }
    onProgress({
      active: true,
      percent: Math.round(((i + 1) / Math.max(1, uniqueFileIds.length)) * 25),
      stage: `Leyendo ${source.name}...`,
    });
    const bytes = new Uint8Array(await source.file.arrayBuffer());
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    loadedDocs.set(fileId, doc);
    await yieldToMain();
  }

  const outDoc = await PDFDocument.create();

  for (let i = 0; i < pages.length; i++) {
    const pageItem = pages[i];
    const srcDoc = loadedDocs.get(pageItem.sourceFileId);
    if (!srcDoc) continue;

    const pageIndex = pageItem.originalPageNumber - 1;
    if (pageIndex < 0 || pageIndex >= srcDoc.getPageCount()) continue;

    onProgress({
      active: true,
      percent: 25 + Math.round(((i + 1) / pages.length) * 65),
      stage: `Ensamblando página ${i + 1} de ${pages.length} (${pageItem.sourceFileName} · Pág. ${pageItem.originalPageNumber})...`,
      currentPage: i + 1,
      totalPages: pages.length,
    });

    const [copiedPage] = await outDoc.copyPages(srcDoc, [pageIndex]);
    applyPdfPageRotation(copiedPage, pageItem.rotation);
    outDoc.addPage(copiedPage);

    if (i % 6 === 5) {
      await yieldToMain();
    }
  }

  if (stripMetadata) {
    clearMetadata(outDoc);
  }

  onProgress({
    active: true,
    percent: 95,
    stage: 'Guardando PDF organizado...',
    currentPage: pages.length,
    totalPages: pages.length,
  });

  const outBytes = await outDoc.save({ useObjectStreams: true });
  const cleanName = stripExtension(outputName.trim() || 'documento_ordenado');

  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
    currentPage: pages.length,
    totalPages: pages.length,
  });

  return {
    blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
    fileName: `${cleanName}.pdf`,
    pageCount: outDoc.getPageCount(),
  };
}
