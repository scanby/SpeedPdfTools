import { formatPdfOpenError, openPdfDocument, pdfjsLib } from './pdfjsSetup';
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
  UnlockPdfSettings,
} from '../types/speedpdf';
import { parsePageRange, stripExtension, yieldToMain } from './formatters';

const MAX_RENDER_SIDE = 4800;
const MAX_RENDER_AREA = 20_000_000;
const MAX_THUMB_SIDE = 720;

function normalizeRotation(angle = 0): number {
  return ((Math.round(angle) % 360) + 360) % 360;
}

function snapRotation90(angle = 0): number {
  const norm = normalizeRotation(angle);
  return (Math.round(norm / 90) * 90) % 360;
}

export function applyPdfPageRotation(page: PDFPage, extraDegrees = 0): void {
  const norm = snapRotation90(extraDegrees);
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

type PdfDocHandle = Awaited<ReturnType<typeof openPdfDocument>['promise']>;
type PdfPageHandle = Awaited<ReturnType<PdfDocHandle['getPage']>>;

export function computeClampedRenderViewport(
  page: PdfPageHandle,
  targetDpi: number,
  extraRotation = 0
) {
  const effectiveRotation = snapRotation90((page.rotate || 0) + extraRotation);
  const baseViewport = page.getViewport({ scale: 1, rotation: effectiveRotation });
  const desiredScale = Math.max(0.1, targetDpi / 72);
  const rawW = Math.max(1, baseViewport.width * desiredScale);
  const rawH = Math.max(1, baseViewport.height * desiredScale);
  const sideFactor = Math.min(1, MAX_RENDER_SIDE / Math.max(rawW, rawH));
  const areaFactor = Math.min(1, Math.sqrt(MAX_RENDER_AREA / (rawW * rawH)));
  const safeScale = Math.max(0.05, desiredScale * Math.min(sideFactor, areaFactor));
  const renderViewport = page.getViewport({ scale: safeScale, rotation: effectiveRotation });
  return { baseViewport, renderViewport };
}

export async function renderPageToCanvas(
  page: PdfPageHandle,
  viewport: ReturnType<PdfPageHandle['getViewport']>,
  alpha = false
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d', { alpha, willReadFrequently: true });

  if (!ctx) {
    releaseCanvas(canvas);
    throw new Error('Contexto gráfico 2D no disponible en el navegador.');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvas: null,
    canvasContext: ctx,
    viewport,
    background: '#ffffff',
    annotationMode: pdfjsLib.AnnotationMode.ENABLE,
  }).promise;

  return canvas;
}

export async function rebuildCleanPdfViaPdfJs(
  sourceBytes: Uint8Array,
  options: {
    fileName?: string;
    password?: string;
    dpi?: number;
    jpegQuality?: number;
    extraRotation?: number;
    onProgress?: (state: ProgressState) => void;
    stagePrefix?: string;
  } = {}
): Promise<PDFDocument> {
  const dpi = options.dpi ?? 200;
  const jpegQuality = options.jpegQuality ?? 0.93;
  const rotNorm = snapRotation90(options.extraRotation ?? 0);
  const loadingTask = openPdfDocument(sourceBytes, options.password);
  let srcPdf: PdfDocHandle;

  try {
    srcPdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    throw formatPdfOpenError(err, options.fileName);
  }

  const outDoc = await PDFDocument.create();
  const totalPages = srcPdf.numPages;

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      options.onProgress?.({
        active: true,
        percent: Math.round(((pageNum - 1) / Math.max(1, totalPages)) * 75) + 10,
        stage: `${options.stagePrefix || 'Normalizando página'} ${pageNum} de ${totalPages}...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await srcPdf.getPage(pageNum);
      const { baseViewport, renderViewport } = computeClampedRenderViewport(page, dpi, rotNorm);
      const canvas = await renderPageToCanvas(page, renderViewport, false);

      let jpegBytes: Uint8Array;
      try {
        const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
        jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }

      const embedded = await outDoc.embedJpg(jpegBytes);
      const pageW = Math.max(1, baseViewport.width);
      const pageH = Math.max(1, baseViewport.height);
      const outPage = outDoc.addPage([pageW, pageH]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH,
      });

      await yieldToMain();
    }

    return outDoc;
  } finally {
    await srcPdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function loadCleanPdfDocument(
  sourceBytes: Uint8Array,
  options: {
    fileName?: string;
    dpi?: number;
    jpegQuality?: number;
    onProgress?: (state: ProgressState) => void;
    stagePrefix?: string;
  } = {}
): Promise<{ doc: PDFDocument; rebuiltFromEncrypted: boolean }> {
  try {
    const rawDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    if (!rawDoc.isEncrypted) {
      return { doc: rawDoc, rebuiltFromEncrypted: false };
    }
  } catch {
    // Si pdf-lib falla al analizar el PDF, se reconstruye limpiamente con PDF.js
  }

  const cleanDoc = await rebuildCleanPdfViaPdfJs(sourceBytes, {
    fileName: options.fileName,
    dpi: options.dpi ?? 200,
    jpegQuality: options.jpegQuality ?? 0.93,
    onProgress: options.onProgress,
    stagePrefix: options.stagePrefix || 'Desbloqueando contenido protegido de página',
  });
  return { doc: cleanDoc, rebuiltFromEncrypted: true };
}

export async function inspectPdfFile(file: File): Promise<{
  pageCount: number;
  thumbnailUrl?: string;
  requiresPassword?: boolean;
}> {
  const buffer = await file.arrayBuffer();
  const loadingTask = openPdfDocument(new Uint8Array(buffer));
  let pdf: PdfDocHandle;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    const isPasswordErr =
      err instanceof pdfjsLib.PasswordException ||
      (typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name?: string }).name === 'PasswordException');
    if (isPasswordErr) {
      return { pageCount: 0, requiresPassword: true };
    }
    throw formatPdfOpenError(err, file.name);
  }

  try {
    const pageCount = pdf.numPages;
    let thumbnailUrl: string | undefined;

    if (pageCount > 0) {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 1, rotation: snapRotation90(page.rotate || 0) });
      const targetWidth = 140;
      const scale = Math.min(
        targetWidth / Math.max(1, viewport.width),
        MAX_THUMB_SIDE / Math.max(1, viewport.height)
      );
      const scaled = page.getViewport({ scale: Math.max(0.05, scale), rotation: snapRotation90(page.rotate || 0) });

      const canvas = await renderPageToCanvas(page, scaled, false);
      try {
        thumbnailUrl = canvas.toDataURL('image/jpeg', 0.72);
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }
    }

    return { pageCount, thumbnailUrl };
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function inspectPdfProtection(
  file: File
): Promise<{ requiresOpenPassword: boolean; pageCount: number }> {
  const buffer = await file.arrayBuffer();
  const loadingTask = openPdfDocument(new Uint8Array(buffer));
  let pdf: PdfDocHandle;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    const isPasswordErr =
      err instanceof pdfjsLib.PasswordException ||
      (typeof err === 'object' &&
        err !== null &&
        'name' in err &&
        (err as { name?: string }).name === 'PasswordException');
    if (isPasswordErr) {
      return { requiresOpenPassword: true, pageCount: 0 };
    }
    throw formatPdfOpenError(err, file.name);
  }
  try {
    return { requiresOpenPassword: false, pageCount: pdf.numPages };
  } finally {
    await Promise.race([
      Promise.allSettled([pdf.cleanup(), loadingTask.destroy()]),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
  }
}

export async function unlockPdf(
  file: File,
  settings: UnlockPdfSettings,
  onProgress: (state: ProgressState) => void,
  extraRotation = 0,
  passwordOverride?: string
): Promise<{ blob: Blob; fileName: string; pageCount: number; wasProtected: boolean }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const rotNorm = snapRotation90(extraRotation);
  const password = (passwordOverride !== undefined ? passwordOverride : settings.password).trim();

  onProgress({
    active: true,
    percent: 10,
    stage: `Analizando cifrado y restricciones de ${file.name}...`,
  });

  let isEncrypted = false;
  let parsedUnencryptedDoc: PDFDocument | null = null;
  try {
    const rawDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    isEncrypted = rawDoc.isEncrypted;
    if (!isEncrypted) {
      parsedUnencryptedDoc = rawDoc;
    }
  } catch {
    isEncrypted = true;
  }

  if (!isEncrypted && parsedUnencryptedDoc && !password) {
    let outDoc = await PDFDocument.create();
    let totalPages = parsedUnencryptedDoc.getPageCount();
    const indices = Array.from({ length: totalPages }, (_, i) => i);

    onProgress({
      active: true,
      percent: 55,
      stage: 'Generando copia limpia sin restricciones...',
      currentPage: totalPages,
      totalPages,
    });

    try {
      const copied = await outDoc.copyPages(parsedUnencryptedDoc, indices);
      for (const p of copied) {
        applyPdfPageRotation(p, rotNorm);
        outDoc.addPage(p);
      }
    } catch {
      outDoc = await rebuildCleanPdfViaPdfJs(sourceBytes, {
        fileName: file.name,
        dpi: settings.dpi,
        jpegQuality: settings.jpegQuality,
        extraRotation: rotNorm,
        onProgress,
        stagePrefix: 'Desprotegiendo página',
      });
      totalPages = outDoc.getPageCount();
    }

    if (settings.stripMetadata) {
      clearMetadata(outDoc);
    }

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
      fileName: `${stripExtension(file.name)}_desprotegido.pdf`,
      pageCount: totalPages,
      wasProtected: false,
    };
  }

  const outDoc = await rebuildCleanPdfViaPdfJs(sourceBytes, {
    fileName: file.name,
    password: password || undefined,
    dpi: settings.dpi,
    jpegQuality: settings.jpegQuality,
    extraRotation: rotNorm,
    onProgress,
    stagePrefix: 'Desprotegiendo página',
  });

  if (settings.stripMetadata) {
    clearMetadata(outDoc);
  }

  onProgress({
    active: true,
    percent: 92,
    stage: 'Empaquetando PDF desprotegido sin restricciones...',
    currentPage: outDoc.getPageCount(),
    totalPages: outDoc.getPageCount(),
  });

  const outBytes = await outDoc.save({ useObjectStreams: true });
  const totalPages = outDoc.getPageCount();

  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
    currentPage: totalPages,
    totalPages,
  });

  return {
    blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
    fileName: `${stripExtension(file.name)}_desprotegido.pdf`,
    pageCount: totalPages,
    wasProtected: true,
  };
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
  const rotNorm = snapRotation90(extraRotation);

  if (settings.structuralOnly) {
    onProgress({
      active: true,
      percent: 15,
      stage: 'Analizando estructura de objetos PDF...',
    });

    const { doc: srcDoc, rebuiltFromEncrypted } = await loadCleanPdfDocument(sourceBytes, {
      fileName: file.name,
      dpi: Math.max(settings.dpi, 180),
      jpegQuality: Math.max(settings.jpegQuality, 0.9),
      onProgress,
      stagePrefix: 'Normalizando PDF protegido',
    });

    let outDoc: PDFDocument;
    let totalPages = srcDoc.getPageCount();

    if (rebuiltFromEncrypted) {
      outDoc = srcDoc;
      for (let i = 0; i < totalPages; i++) {
        applyPdfPageRotation(outDoc.getPage(i), rotNorm);
      }
    } else {
      outDoc = await PDFDocument.create();
      const indices = Array.from({ length: totalPages }, (_, i) => i);

      onProgress({
        active: true,
        percent: 55,
        stage: 'Reconstruyendo flujos de objetos comprimidos...',
        currentPage: totalPages,
        totalPages,
      });

      try {
        const copied = await outDoc.copyPages(srcDoc, indices);
        for (const p of copied) {
          applyPdfPageRotation(p, rotNorm);
          outDoc.addPage(p);
        }
      } catch {
        // Respaldo si el PDF tiene referencias indirectas dañadas al copiar con pdf-lib
        outDoc = await rebuildCleanPdfViaPdfJs(sourceBytes, {
          fileName: file.name,
          dpi: Math.max(settings.dpi, 180),
          jpegQuality: Math.max(settings.jpegQuality, 0.9),
          onProgress,
          stagePrefix: 'Reconstruyendo página',
        });
        totalPages = outDoc.getPageCount();
        for (let i = 0; i < totalPages; i++) {
          applyPdfPageRotation(outDoc.getPage(i), rotNorm);
        }
      }
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
  const loadingTask = openPdfDocument(sourceBytes);
  let srcPdf: PdfDocHandle;
  try {
    srcPdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    throw formatPdfOpenError(err, file.name);
  }

  const outDoc = await PDFDocument.create();
  const totalPages = srcPdf.numPages;

  try {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / Math.max(1, totalPages)) * 90) + 5,
        stage: `Comprimiendo página ${pageNum} de ${totalPages} (${settings.dpi} DPI)...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await srcPdf.getPage(pageNum);
      const { baseViewport, renderViewport } = computeClampedRenderViewport(
        page,
        settings.dpi,
        rotNorm
      );
      const canvas = await renderPageToCanvas(page, renderViewport, false);

      let jpegBytes: Uint8Array;
      try {
        const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', settings.jpegQuality);
        jpegBytes = new Uint8Array(await jpegBlob.arrayBuffer());
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }

      const embedded = await outDoc.embedJpg(jpegBytes);
      const pageW = Math.max(1, baseViewport.width);
      const pageH = Math.max(1, baseViewport.height);
      const outPage = outDoc.addPage([pageW, pageH]);
      outPage.drawImage(embedded, {
        x: 0,
        y: 0,
        width: pageW,
        height: pageH,
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
    const { doc: srcDoc } = await loadCleanPdfDocument(bytes, {
      fileName: item.name,
      dpi: 200,
      jpegQuality: 0.93,
    });
    const rot = snapRotation90(item.rotation ?? 0);
    const indices = parsePageRange(item.pageRange, srcDoc.getPageCount());

    try {
      const pages = await outDoc.copyPages(srcDoc, indices);
      for (const p of pages) {
        applyPdfPageRotation(p, rot);
        outDoc.addPage(p);
        totalCopiedPages++;
      }
    } catch {
      const rebuiltDoc = await rebuildCleanPdfViaPdfJs(bytes, {
        fileName: item.name,
        dpi: 200,
        jpegQuality: 0.93,
      });
      const safeIndices = parsePageRange(item.pageRange, rebuiltDoc.getPageCount());
      const pages = await outDoc.copyPages(rebuiltDoc, safeIndices);
      for (const p of pages) {
        applyPdfPageRotation(p, rot);
        outDoc.addPage(p);
        totalCopiedPages++;
      }
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
  const rotNorm = snapRotation90(extraRotation) || 90;

  onProgress({
    active: true,
    percent: 25,
    stage: `Aplicando rotación de ${rotNorm}° a ${file.name}...`,
  });

  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const { doc: pdfDoc } = await loadCleanPdfDocument(sourceBytes, {
    fileName: file.name,
    dpi: 200,
    jpegQuality: 0.93,
    onProgress,
    stagePrefix: 'Preparando página',
  });
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
): Promise<{ blob: Blob; fileName: string; pageCount: number }[]> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const rotNorm = snapRotation90(extraRotation);
  const loadingTask = openPdfDocument(sourceBytes);
  let pdf: PdfDocHandle;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    throw formatPdfOpenError(err, file.name);
  }

  const totalPages = pdf.numPages;
  const ext = settings.format === 'png' ? 'png' : 'jpg';
  const mimeType = settings.format === 'png' ? 'image/png' : 'image/jpeg';
  const baseName = stripExtension(file.name);

  try {
    if (totalPages === 1) {
      onProgress({
        active: true,
        percent: 45,
        stage: `Renderizando página 1 a ${settings.dpi} DPI...`,
        currentPage: 1,
        totalPages: 1,
      });

      const page = await pdf.getPage(1);
      const { renderViewport } = computeClampedRenderViewport(page, settings.dpi, rotNorm);
      const canvas = await renderPageToCanvas(page, renderViewport, settings.format === 'png');

      let imgBlob: Blob;
      try {
        imgBlob = await canvasToBlob(
          canvas,
          mimeType,
          settings.format === 'jpeg' ? settings.quality : undefined
        );
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }

      onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: 1, totalPages: 1 });
      return [
        {
          blob: imgBlob,
          fileName: `${baseName}_a_${ext}.${ext}`,
          pageCount: 1,
        },
      ];
    }

    const individualOutputs: { blob: Blob; fileName: string; pageCount: number }[] = [];
    const zip = settings.bundleAsZip ? new JSZip() : null;

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      onProgress({
        active: true,
        percent: Math.round(((pageNum - 1) / totalPages) * 85) + 5,
        stage: `Exportando página ${pageNum} de ${totalPages} (${ext.toUpperCase()})...`,
        currentPage: pageNum,
        totalPages,
      });

      const page = await pdf.getPage(pageNum);
      const { renderViewport } = computeClampedRenderViewport(page, settings.dpi, rotNorm);
      const canvas = await renderPageToCanvas(page, renderViewport, settings.format === 'png');

      let imgBlob: Blob;
      try {
        imgBlob = await canvasToBlob(
          canvas,
          mimeType,
          settings.format === 'jpeg' ? settings.quality : undefined
        );
      } finally {
        releaseCanvas(canvas);
        page.cleanup();
      }

      const padded = String(pageNum).padStart(3, '0');
      const pageFileName = `${baseName}_a_${ext}_pag_${padded}.${ext}`;
      if (zip) {
        zip.file(pageFileName, imgBlob);
      } else {
        individualOutputs.push({
          blob: imgBlob,
          fileName: pageFileName,
          pageCount: totalPages,
        });
      }
      await yieldToMain();
    }

    if (zip) {
      onProgress({
        active: true,
        percent: 94,
        stage: 'Comprimiendo paquete ZIP local...',
        currentPage: totalPages,
        totalPages,
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: totalPages, totalPages });

      return [
        {
          blob: zipBlob,
          fileName: `${baseName}_paginas_${ext}.zip`,
          pageCount: totalPages,
        },
      ];
    }

    onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: totalPages, totalPages });
    return individualOutputs;
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

    const lowerName = file.name.toLowerCase();
    const isPng = file.type === 'image/png' || lowerName.endsWith('.png');
    const isJpeg =
      file.type === 'image/jpeg' || lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');

    // Conservar bytes originales sin recomprimir cuando no hay rotación y la calidad es alta/original
    if (rotNorm === 0 && isPng && jpegQuality >= 0.92) {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: 'png',
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    }

    if (rotNorm === 0 && isJpeg && jpegQuality >= 0.92) {
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
    const ctx = canvas.getContext('2d', { alpha: isPng });
    if (!ctx) throw new Error('Contexto gráfico no disponible.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (!isPng) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((rotNorm * Math.PI) / 180);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    ctx.restore();

    if (isPng) {
      const blob = await canvasToBlob(canvas, 'image/png');
      releaseCanvas(canvas);
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        kind: 'png',
        width: outW,
        height: outH,
      };
    }

    const blob = await canvasToBlob(canvas, 'image/jpeg', Math.min(0.96, Math.max(0.7, jpegQuality)));
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
  const baseName =
    files.length === 1
      ? `${stripExtension(files[0].name)}_a_pdf`
      : `${stripExtension(files[0].name)}_imagenes_a_pdf`;

  onProgress({ active: false, percent: 100, stage: 'Completado', currentPage: files.length, totalPages: files.length });

  return {
    blob: new Blob([new Uint8Array(outBytes)], { type: 'application/pdf' }),
    fileName: `${baseName}.pdf`,
    pageCount: files.length,
  };
}

export async function getPdfPageCount(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const loadingTask = openPdfDocument(new Uint8Array(buffer));
  let pdf: PdfDocHandle;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    throw formatPdfOpenError(err, file.name);
  }
  try {
    return pdf.numPages;
  } finally {
    await pdf.cleanup();
    await loadingTask.destroy();
  }
}

export async function openPdfForOrganizerAndRenderThumbnails(
  file: File,
  onReady: (totalPages: number) => void,
  onBatchRendered: (thumbnailsByPage: Record<number, string>, failedPages: number[]) => void,
  isCancelled?: () => boolean
): Promise<number> {
  const buffer = await file.arrayBuffer();
  const loadingTask = openPdfDocument(new Uint8Array(buffer));
  let pdf: PdfDocHandle;
  try {
    pdf = await loadingTask.promise;
  } catch (err) {
    await loadingTask.destroy().catch(() => {});
    throw formatPdfOpenError(err, file.name);
  }

  try {
    const totalPages = pdf.numPages;
    onReady(totalPages);

    if (isCancelled?.() || totalPages === 0) {
      return totalPages;
    }

    let pendingThumbs: Record<number, string> = {};
    let pendingFailed: number[] = [];
    let pendingCount = 0;

    const flushBatch = () => {
      if (pendingCount === 0 || isCancelled?.()) return;
      const thumbs = pendingThumbs;
      const failed = pendingFailed;
      pendingThumbs = {};
      pendingFailed = [];
      pendingCount = 0;
      onBatchRendered(thumbs, failed);
    };

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (isCancelled?.()) break;

      try {
        const page = await pdf.getPage(pageNum);
        const rot = snapRotation90(page.rotate || 0);
        const baseViewport = page.getViewport({ scale: 1, rotation: rot });
        const targetWidth = 144;
        const scale = Math.min(
          targetWidth / Math.max(1, baseViewport.width),
          MAX_THUMB_SIDE / Math.max(1, baseViewport.height)
        );
        const viewport = page.getViewport({ scale: Math.max(0.05, scale), rotation: rot });
        const canvas = await renderPageToCanvas(page, viewport, false);
        try {
          pendingThumbs[pageNum] = canvas.toDataURL('image/jpeg', 0.7);
          pendingCount += 1;
        } finally {
          releaseCanvas(canvas);
          page.cleanup();
        }
      } catch {
        pendingFailed.push(pageNum);
        pendingCount += 1;
      }

      if (pendingCount >= 4 || pageNum === totalPages) {
        flushBatch();
      }
      await yieldToMain();
    }

    flushBatch();
    return totalPages;
  } finally {
    await Promise.race([
      Promise.allSettled([
        pdf.cleanup().catch(() => {}),
        loadingTask.destroy().catch(() => {}),
      ]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }
}

export async function renderPdfAllPageThumbnails(
  file: File,
  onPageRendered: (pageNumber: number, thumbnailUrl: string) => void,
  isCancelled?: () => boolean
): Promise<number> {
  return openPdfForOrganizerAndRenderThumbnails(
    file,
    () => {},
    (batch) => {
      for (const [k, url] of Object.entries(batch)) {
        onPageRendered(Number(k), url);
      }
    },
    isCancelled
  );
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

  const loadedDocs = new Map<string, { doc: PDFDocument; bytes: Uint8Array; name: string }>();
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
    const { doc } = await loadCleanPdfDocument(bytes, {
      fileName: source.name,
      dpi: 200,
      jpegQuality: 0.93,
    });
    loadedDocs.set(fileId, { doc, bytes, name: source.name });
    await yieldToMain();
  }

  const outDoc = await PDFDocument.create();
  const rebuiltFallbackDocs = new Map<string, PDFDocument>();

  for (let i = 0; i < pages.length; i++) {
    const pageItem = pages[i];
    const loaded = loadedDocs.get(pageItem.sourceFileId);
    if (!loaded) continue;

    let srcDoc = rebuiltFallbackDocs.get(pageItem.sourceFileId) ?? loaded.doc;
    const pageIndex = pageItem.originalPageNumber - 1;
    if (pageIndex < 0 || pageIndex >= srcDoc.getPageCount()) continue;

    onProgress({
      active: true,
      percent: 25 + Math.round(((i + 1) / pages.length) * 65),
      stage: `Ensamblando página ${i + 1} de ${pages.length} (${pageItem.sourceFileName} · Pág. ${pageItem.originalPageNumber})...`,
      currentPage: i + 1,
      totalPages: pages.length,
    });

    try {
      const [copiedPage] = await outDoc.copyPages(srcDoc, [pageIndex]);
      applyPdfPageRotation(copiedPage, pageItem.rotation);
      outDoc.addPage(copiedPage);
    } catch {
      let cleanDoc = rebuiltFallbackDocs.get(pageItem.sourceFileId);
      if (!cleanDoc) {
        cleanDoc = await rebuildCleanPdfViaPdfJs(loaded.bytes, {
          fileName: loaded.name,
          dpi: 200,
          jpegQuality: 0.93,
        });
        rebuiltFallbackDocs.set(pageItem.sourceFileId, cleanDoc);
      }
      srcDoc = cleanDoc;
      if (pageIndex < srcDoc.getPageCount()) {
        const [copiedPage] = await outDoc.copyPages(srcDoc, [pageIndex]);
        applyPdfPageRotation(copiedPage, pageItem.rotation);
        outDoc.addPage(copiedPage);
      }
    }

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
