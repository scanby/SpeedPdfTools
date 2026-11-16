import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import JSZip from 'jszip';
import { PDFDocument, PageSizes } from 'pdf-lib';
import {
  CompressionSettings,
  ImageExportSettings,
  ImageToPdfSettings,
  ProgressState,
  QueueFileItem,
} from '../types/speedpdf';
import { parsePageRange, stripExtension, yieldToMain } from './formatters';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());

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
      const baseViewport = page.getViewport({ scale: 1 });
      const renderViewport = page.getViewport({ scale });

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

    for (const p of pages) {
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

export async function pdfToImages(
  file: File,
  settings: ImageExportSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
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
      const viewport = page.getViewport({ scale });
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
      const viewport = page.getViewport({ scale });
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
  jpegQuality: number
): Promise<{ bytes: Uint8Array; kind: 'png' | 'jpg'; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`No se pudo decodificar la imagen ${file.name}.`));
      el.src = url;
    });

    const isPng = file.type === 'image/png' || file.name.toLowerCase().endsWith('.png');
    if (isPng && jpegQuality >= 0.92) {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: 'png',
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    }

    if (file.type === 'image/jpeg' && jpegQuality >= 0.92) {
      return {
        bytes: new Uint8Array(await file.arrayBuffer()),
        kind: 'jpg',
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
    }

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Contexto gráfico no disponible.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const blob = await canvasToBlob(canvas, 'image/jpeg', jpegQuality);
    releaseCanvas(canvas);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      kind: 'jpg',
      width: img.naturalWidth,
      height: img.naturalHeight,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function imagesToPdf(
  files: File[],
  settings: ImageToPdfSettings,
  onProgress: (state: ProgressState) => void
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

    const normalized = await normalizeImageBytesForPdf(file, settings.jpegQuality);
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
