import './polyfillsAuto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from './pdfWorkerBootstrap.ts?worker&url';

if (typeof pdfWorkerUrl === 'string' && pdfWorkerUrl) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

/**
 * Sustituye DOMFilterFactory (filtros SVG url(#...) en document.body) por respuestas "none",
 * activando en pdf.js el respaldo puro por píxeles en JavaScript para SMask, Alpha/Luminosity
 * y Transfer Maps. Evita partes faltantes o páginas en blanco bajo Chromium 108 sin GPU y app://.
 */
class SoftwareFilterFactory {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addKnockoutFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  addSelectionHCMFilter() {
    return 'none';
  }
  addSelectionFilter() {
    return 'none';
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

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

export function formatPdfOpenError(err: unknown, fileName?: string): Error {
  const prefix = fileName ? `No se pudo procesar "${fileName}"` : 'No se pudo procesar el PDF';
  if (err && typeof err === 'object') {
    const maybeErr = err as { name?: string; code?: number; message?: string };
    if (maybeErr.name === 'PasswordException') {
      if (maybeErr.code === 2) {
        return new Error(`${prefix}: contraseña de apertura incorrecta.`);
      }
      return new Error(
        `${prefix}: el archivo está protegido con contraseña de apertura. Ingrésala en el módulo Desproteger PDF para desbloquearlo.`
      );
    }
    if (maybeErr.name === 'InvalidPDFException') {
      return new Error(`${prefix}: la estructura del archivo PDF está dañada o es inválida.`);
    }
    if (maybeErr.message) {
      return new Error(`${prefix}: ${maybeErr.message}`);
    }
  }
  return new Error(`${prefix}.`);
}

export function openPdfDocument(sourceBytes: Uint8Array, password?: string) {
  const cMapUrl = resolvePdfJsAssetBase('cmaps');
  const standardFontDataUrl = resolvePdfJsAssetBase('standard_fonts');
  const wasmUrl = resolvePdfJsAssetBase('wasm');
  const iccUrl = resolvePdfJsAssetBase('iccs');
  const softwareOnly = shouldPreferSoftwareRendering();

  // Copia defensiva: pdf.js puede transferir el ArrayBuffer al worker y dejar vacío el buffer original.
  const isolatedBytes = sourceBytes.slice();

  return pdfjsLib.getDocument({
    data: isolatedBytes,
    password: password || undefined,
    cMapUrl,
    cMapPacked: true,
    standardFontDataUrl,
    wasmUrl,
    iccUrl,
    useWasm: true,
    // Renderizar glifos mediante trazados vectoriales Path2D en lugar de FontFace/OTS de Chromium:
    // evita que las fuentes desaparezcan dejando solo líneas de tablas o bordes en ventanas ocultas o Chromium 108.
    disableFontFace: true,
    useSystemFonts: false,
    FilterFactory: SoftwareFilterFactory,
    // Limita lienzos temporales internos (patrones, SMask) a 64 MB (16M px) para evitar fallos silenciosos en blanco.
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
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

