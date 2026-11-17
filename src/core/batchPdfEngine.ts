import { PDFDocument } from 'pdf-lib';
import {
  ImageToPdfSettings,
  ProgressState,
  QueueFileItem,
  WordConversionSettings,
} from '../types/speedpdf';
import { docxToPdf } from './docxBridge';
import { stripExtension, yieldToMain } from './formatters';
import { applyPdfPageRotation, imagesToPdf } from './pdfEngine';

export interface SeparatePdfResult {
  blob: Blob;
  fileName: string;
  originalSize: number;
  pageCount: number;
  sourceKind: QueueFileItem['kind'];
}

async function convertSingleItemToPdfBytes(
  item: QueueFileItem,
  imageSettings: ImageToPdfSettings,
  wordSettings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ pdfBytes: Uint8Array; pageCount: number }> {
  if (item.kind === 'pdf') {
    const raw = new Uint8Array(await item.file.arrayBuffer());
    const doc = await PDFDocument.load(raw, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    const rot = item.rotation ?? 0;
    if (rot !== 0) {
      for (let i = 0; i < pageCount; i++) {
        applyPdfPageRotation(doc.getPage(i), rot);
      }
    }
    const saved = await doc.save({ useObjectStreams: true });
    return { pdfBytes: new Uint8Array(saved), pageCount };
  }

  if (item.kind === 'docx') {
    const res = await docxToPdf(item.file, wordSettings, onProgress);
    return {
      pdfBytes: new Uint8Array(await res.blob.arrayBuffer()),
      pageCount: res.pageCount,
    };
  }

  if (item.kind === 'image') {
    const res = await imagesToPdf([item.file], imageSettings, onProgress, [item.rotation ?? 0]);
    return {
      pdfBytes: new Uint8Array(await res.blob.arrayBuffer()),
      pageCount: res.pageCount,
    };
  }

  throw new Error(`El archivo ${item.name} (.speedvault) debe descifrarse antes de convertirlo a PDF.`);
}

export async function convertMixedBatchToSinglePdf(
  items: QueueFileItem[],
  outputName: string,
  imageSettings: ImageToPdfSettings,
  wordSettings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<{ blob: Blob; fileName: string; pageCount: number }> {
  if (items.length === 0) {
    throw new Error('Selecciona al menos un archivo para convertir a PDF.');
  }

  const outDoc = await PDFDocument.create();
  let totalPages = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const basePercent = Math.round((i / items.length) * 85) + 5;
    onProgress({
      active: true,
      percent: basePercent,
      stage: `Convirtiendo e integrando (${i + 1}/${items.length}): ${item.name}`,
      currentPage: i + 1,
      totalPages: items.length,
    });

    const { pdfBytes } = await convertSingleItemToPdfBytes(
      item,
      imageSettings,
      wordSettings,
      () => {}
    );

    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const indices = Array.from({ length: srcDoc.getPageCount() }, (_, idx) => idx);
    const copiedPages = await outDoc.copyPages(srcDoc, indices);

    for (const page of copiedPages) {
      outDoc.addPage(page);
      totalPages++;
    }

    await yieldToMain();
  }

  outDoc.setProducer('SPEED.PDF Local');
  outDoc.setCreator('SPEED.PDF');

  onProgress({
    active: true,
    percent: 96,
    stage: 'Generando PDF unificado...',
  });

  const mergedBytes = await outDoc.save({ useObjectStreams: true });
  const cleanName = stripExtension(outputName.trim() || 'lote_convertido_unificado');

  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
  });

  return {
    blob: new Blob([new Uint8Array(mergedBytes)], { type: 'application/pdf' }),
    fileName: `${cleanName}.pdf`,
    pageCount: totalPages,
  };
}

export async function convertMixedBatchToSeparatePdfs(
  items: QueueFileItem[],
  imageSettings: ImageToPdfSettings,
  wordSettings: WordConversionSettings,
  onProgress: (state: ProgressState) => void
): Promise<SeparatePdfResult[]> {
  if (items.length === 0) {
    throw new Error('Selecciona al menos un archivo para convertir a PDF.');
  }

  const results: SeparatePdfResult[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress({
      active: true,
      percent: Math.round((i / items.length) * 90) + 5,
      stage: `Generando PDF individual (${i + 1}/${items.length}): ${item.name}`,
      currentPage: i + 1,
      totalPages: items.length,
    });

    const { pdfBytes, pageCount } = await convertSingleItemToPdfBytes(
      item,
      imageSettings,
      wordSettings,
      () => {}
    );

    const outName =
      item.kind === 'pdf'
        ? `${stripExtension(item.name)}_normalizado.pdf`
        : `${stripExtension(item.name)}.pdf`;

    results.push({
      blob: new Blob([pdfBytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      fileName: outName,
      originalSize: item.size,
      pageCount,
      sourceKind: item.kind,
    });

    await yieldToMain();
  }

  onProgress({
    active: false,
    percent: 100,
    stage: 'Completado',
  });

  return results;
}
