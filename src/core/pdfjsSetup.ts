import './polyfillsAuto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from './pdfWorkerBootstrap.ts?worker&url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function resolvePdfJsAssetBase(subDir: string): string | undefined {
  if (typeof window === 'undefined' || !window.location?.href) return undefined;
  try {
    return new URL(`pdfjs/${subDir}/`, window.location.href).href;
  } catch {
    return undefined;
  }
}

function shouldPreferSoftwareRendering(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Electron/i.test(ua) || /Chrome\/(9\d|10\d|11[0-4])\./i.test(ua);
}

export function openPdfDocument(sourceBytes: Uint8Array) {
  const cMapUrl = resolvePdfJsAssetBase('cmaps');
  const standardFontDataUrl = resolvePdfJsAssetBase('standard_fonts');
  const wasmUrl = resolvePdfJsAssetBase('wasm');
  const iccUrl = resolvePdfJsAssetBase('iccs');
  const softwareOnly = shouldPreferSoftwareRendering();

  return pdfjsLib.getDocument({
    data: sourceBytes,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    wasmUrl,
    iccUrl,
    useWasm: true,
    useSystemFonts: true,
    ...(softwareOnly
      ? {
          isOffscreenCanvasSupported: false,
          isImageDecoderSupported: false,
          disableWorkerRendering: true,
        }
      : {}),
  });
}

export { pdfjsLib };
