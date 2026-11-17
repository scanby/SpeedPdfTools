import { Lock, Play, RotateCw } from 'lucide-react';
import {
  BatchConvertMode,
  CompressionPreset,
  CompressionSettings,
  ImageExportSettings,
  ImageToPdfSettings,
  PdfToolId,
  WordConversionSettings,
} from '../types/speedpdf';

interface ToolSettingsPanelProps {
  activeTool: PdfToolId;
  hasFiles: boolean;
  fileCount: number;
  isProcessing: boolean;
  compression: CompressionSettings;
  onChangeCompression: (next: CompressionSettings) => void;
  mergeOutputName: string;
  onChangeMergeOutputName: (val: string) => void;
  mergeStripMetadata: boolean;
  onChangeMergeStripMetadata: (val: boolean) => void;
  organizeOutputName: string;
  onChangeOrganizeOutputName: (val: string) => void;
  organizeStripMetadata: boolean;
  onChangeOrganizeStripMetadata: (val: boolean) => void;
  organizerPageCount: number;
  organizerFileCount: number;
  rotateStripMetadata: boolean;
  onChangeRotateStripMetadata: (val: boolean) => void;
  onRotateAll: (deltaDegrees: number) => void;
  onResetRotations: () => void;
  imageExport: ImageExportSettings;
  onChangeImageExport: (next: ImageExportSettings) => void;
  imageToPdf: ImageToPdfSettings;
  onChangeImageToPdf: (next: ImageToPdfSettings) => void;
  wordSettings: WordConversionSettings;
  onChangeWordSettings: (next: WordConversionSettings) => void;
  vaultMode: 'encrypt' | 'decrypt';
  onChangeVaultMode: (mode: 'encrypt' | 'decrypt') => void;
  batchConvertMode: BatchConvertMode;
  onChangeBatchConvertMode: (mode: BatchConvertMode) => void;
  batchOutputName: string;
  onChangeBatchOutputName: (val: string) => void;
  encryptOutput: boolean;
  onChangeEncryptOutput: (val: boolean) => void;
  vaultPassword: string;
  onChangeVaultPassword: (val: string) => void;
  onExecute: () => void;
}

const COMPRESSION_PRESETS: {
  id: CompressionPreset;
  label: string;
  desc: string;
  dpi: number;
  quality: number;
  structuralOnly: boolean;
}[] = [
  {
    id: 'extreme',
    label: 'Extrema',
    desc: '96 DPI · Máximo ahorro',
    dpi: 96,
    quality: 0.55,
    structuralOnly: false,
  },
  {
    id: 'balanced',
    label: 'Equilibrada',
    desc: '144 DPI · Lectura nítida',
    dpi: 144,
    quality: 0.75,
    structuralOnly: false,
  },
  {
    id: 'high',
    label: 'Alta calidad',
    desc: '200 DPI · Gráficos finos',
    dpi: 200,
    quality: 0.88,
    structuralOnly: false,
  },
  {
    id: 'lossless',
    label: 'Sin pérdida',
    desc: 'Mantiene texto vectorial',
    dpi: 150,
    quality: 0.9,
    structuralOnly: true,
  },
];

export function ToolSettingsPanel({
  activeTool,
  hasFiles,
  fileCount,
  isProcessing,
  compression,
  onChangeCompression,
  mergeOutputName,
  onChangeMergeOutputName,
  mergeStripMetadata,
  onChangeMergeStripMetadata,
  organizeOutputName,
  onChangeOrganizeOutputName,
  organizeStripMetadata,
  onChangeOrganizeStripMetadata,
  organizerPageCount,
  organizerFileCount,
  rotateStripMetadata,
  onChangeRotateStripMetadata,
  onRotateAll,
  onResetRotations,
  imageExport,
  onChangeImageExport,
  imageToPdf,
  onChangeImageToPdf,
  wordSettings,
  onChangeWordSettings,
  vaultMode,
  onChangeVaultMode,
  batchConvertMode,
  onChangeBatchConvertMode,
  batchOutputName,
  onChangeBatchOutputName,
  encryptOutput,
  onChangeEncryptOutput,
  vaultPassword,
  onChangeVaultPassword,
  onExecute,
}: ToolSettingsPanelProps) {
  const applyPreset = (preset: (typeof COMPRESSION_PRESETS)[number]) => {
    onChangeCompression({
      ...compression,
      preset: preset.id,
      dpi: preset.dpi,
      jpegQuality: preset.quality,
      structuralOnly: preset.structuralOnly,
    });
  };

  const actionLabel = (() => {
    switch (activeTool) {
      case 'compress':
        return fileCount > 1 ? `Comprimir ${fileCount} PDFs` : 'Comprimir PDF';
      case 'merge':
        return `Unir ${fileCount} archivos PDF`;
      case 'organize':
        return organizerPageCount > 0
          ? `Generar PDF ordenado (${organizerPageCount} págs.)`
          : 'Generar PDF ordenado';
      case 'rotate':
        return fileCount > 1 ? `Guardar ${fileCount} PDFs girados` : 'Girar PDF 90°';
      case 'batch-to-pdf':
        return batchConvertMode === 'single-pdf'
          ? `Convertir ${fileCount} archivos en 1 PDF`
          : `Generar ${fileCount} PDFs por separado`;
      case 'pdf-to-img':
        return 'Convertir PDF a imágenes';
      case 'img-to-pdf':
        return `Crear PDF desde ${fileCount} ${fileCount === 1 ? 'imagen' : 'imágenes'}`;
      case 'pdf-to-word':
        return 'Convertir PDF a Word (.docx)';
      case 'word-to-pdf':
        return 'Convertir Word a PDF';
      case 'vault':
        return vaultMode === 'encrypt' ? 'Cifrar archivo localmente' : 'Descifrar archivo local';
    }
  })();

  const isDisabled =
    isProcessing ||
    (activeTool === 'organize' ? organizerPageCount === 0 : !hasFiles) ||
    (activeTool === 'merge' && fileCount < 2) ||
    ((activeTool === 'vault' || encryptOutput) && vaultPassword.trim().length < 4);

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h3 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Ajustes de procesamiento local
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Configura los parámetros antes de ejecutar en memoria segura del dispositivo
          </p>
        </div>
      </div>

      {activeTool === 'compress' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {COMPRESSION_PRESETS.map((preset) => {
              const active = compression.preset === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    active
                      ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <div className="text-sm font-medium">{preset.label}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {preset.desc}
                  </div>
                </button>
              );
            })}
          </div>

          {!compression.structuralOnly && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              <label className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Resolución de muestreo (DPI)
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {compression.dpi} DPI
                  </span>
                </div>
                <input
                  type="range"
                  min={72}
                  max={300}
                  step={12}
                  value={compression.dpi}
                  onChange={(e) =>
                    onChangeCompression({
                      ...compression,
                      preset: 'custom',
                      dpi: Number(e.target.value),
                    })
                  }
                  className="w-full accent-blue-600"
                />
              </label>

              <label className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Calidad de compresión JPEG
                  </span>
                  <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                    {Math.round(compression.jpegQuality * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={35}
                  max={95}
                  step={5}
                  value={Math.round(compression.jpegQuality * 100)}
                  onChange={(e) =>
                    onChangeCompression({
                      ...compression,
                      preset: 'custom',
                      jpegQuality: Number(e.target.value) / 100,
                    })
                  }
                  className="w-full accent-blue-600"
                />
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-slate-700 dark:text-slate-300">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={compression.structuralOnly}
                onChange={(e) =>
                  onChangeCompression({
                    ...compression,
                    preset: e.target.checked ? 'lossless' : 'custom',
                    structuralOnly: e.target.checked,
                  })
                }
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Solo optimización estructural (conserva texto vectorial seleccionable)</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={compression.stripMetadata}
                onChange={(e) =>
                  onChangeCompression({ ...compression, stripMetadata: e.target.checked })
                }
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Eliminar metadatos privados (autor, software, fechas)</span>
            </label>
          </div>
        </div>
      )}

      {activeTool === 'merge' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Nombre del PDF unificado
            </span>
            <input
              type="text"
              value={mergeOutputName}
              onChange={(e) => onChangeMergeOutputName(e.target.value)}
              placeholder="documentos_unidos"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </label>

          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={mergeStripMetadata}
                onChange={(e) => onChangeMergeStripMetadata(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Limpiar metadatos de origen al fusionar</span>
            </label>
          </div>
        </div>
      )}

      {activeTool === 'organize' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Nombre del PDF organizado
            </span>
            <input
              type="text"
              value={organizeOutputName}
              onChange={(e) => onChangeOrganizeOutputName(e.target.value)}
              placeholder="documento_ordenado"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </label>

          <div className="flex flex-col justify-end gap-2 pb-1">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={organizeStripMetadata}
                onChange={(e) => onChangeOrganizeStripMetadata(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Limpiar metadatos de origen al exportar</span>
            </label>
            {organizerFileCount > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Se exportarán {organizerPageCount} {organizerPageCount === 1 ? 'página' : 'páginas'} desde {organizerFileCount}{' '}
                {organizerFileCount === 1 ? 'archivo PDF' : 'archivos PDF'} en el orden exacto de la cuadrícula.
              </span>
            )}
          </div>
        </div>
      )}

      {activeTool === 'rotate' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!hasFiles}
              onClick={() => onRotateAll(90)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Girar todos +90° (derecha)</span>
            </button>
            <button
              type="button"
              disabled={!hasFiles}
              onClick={() => onRotateAll(180)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <span>Girar todos 180°</span>
            </button>
            <button
              type="button"
              disabled={!hasFiles}
              onClick={() => onRotateAll(270)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <span>Girar todos -90° (izquierda)</span>
            </button>
            <button
              type="button"
              disabled={!hasFiles}
              onClick={onResetRotations}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              <span>Restablecer (0°)</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={rotateStripMetadata}
                onChange={(e) => onChangeRotateStripMetadata(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Limpiar metadatos al guardar</span>
            </label>

            <span className="text-xs text-slate-500 dark:text-slate-400">
              Las tarjetas giradas conservan su vista previa exacta; si alguna sigue en 0°, se aplicará +90° por defecto.
            </span>
          </div>
        </div>
      )}

      {activeTool === 'pdf-to-img' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Formato de salida
            </span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(['jpeg', 'png'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => onChangeImageExport({ ...imageExport, format: fmt })}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md uppercase transition-colors ${
                    imageExport.format === fmt
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {fmt === 'jpeg' ? 'JPG' : 'PNG'}
                </button>
              ))}
            </div>
          </div>

          <label className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-300">Resolución</span>
              <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {imageExport.dpi} DPI
              </span>
            </div>
            <select
              value={imageExport.dpi}
              onChange={(e) => onChangeImageExport({ ...imageExport, dpi: Number(e.target.value) })}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value={72}>72 DPI (Pantalla ligera)</option>
              <option value={150}>150 DPI (Uso general)</option>
              <option value={220}>220 DPI (Alta nitidez)</option>
              <option value={300}>300 DPI (Impresión)</option>
            </select>
          </label>

          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={imageExport.bundleAsZip}
                onChange={(e) =>
                  onChangeImageExport({ ...imageExport, bundleAsZip: e.target.checked })
                }
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Empaquetar páginas en archivo ZIP</span>
            </label>
          </div>
        </div>
      )}

      {activeTool === 'img-to-pdf' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tamaño de página
            </span>
            <select
              value={imageToPdf.pageSize}
              onChange={(e) =>
                onChangeImageToPdf({
                  ...imageToPdf,
                  pageSize: e.target.value as ImageToPdfSettings['pageSize'],
                })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="a4">A4 estándar</option>
              <option value="letter">Carta (Letter)</option>
              <option value="fit">Ajustar a cada imagen</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Orientación
            </span>
            <select
              value={imageToPdf.orientation}
              onChange={(e) =>
                onChangeImageToPdf({
                  ...imageToPdf,
                  orientation: e.target.value as ImageToPdfSettings['orientation'],
                })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="auto">Automática por imagen</option>
              <option value="portrait">Vertical</option>
              <option value="landscape">Horizontal</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Margen interior
            </span>
            <select
              value={imageToPdf.marginPt}
              onChange={(e) =>
                onChangeImageToPdf({ ...imageToPdf, marginPt: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value={0}>Sin margen (0 pt)</option>
              <option value={18}>Margen estrecho (18 pt)</option>
              <option value={36}>Margen estándar (36 pt)</option>
            </select>
          </label>
        </div>
      )}

      {(activeTool === 'pdf-to-word' || activeTool === 'word-to-pdf') && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Tamaño base de página
            </span>
            <select
              value={wordSettings.pageSize}
              onChange={(e) =>
                onChangeWordSettings({
                  ...wordSettings,
                  pageSize: e.target.value as 'a4' | 'letter',
                })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value="a4">A4 (210 × 297 mm)</option>
              <option value="letter">Carta (8.5 × 11 in)</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
              Cuerpo tipográfico
            </span>
            <select
              value={wordSettings.fontSize}
              onChange={(e) =>
                onChangeWordSettings({ ...wordSettings, fontSize: Number(e.target.value) })
              }
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            >
              <option value={10}>10 pt (Compacto)</option>
              <option value={11}>11 pt (Estándar)</option>
              <option value={12}>12 pt (Lectura amplia)</option>
            </select>
          </label>

          <div className="flex items-end pb-2">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={wordSettings.preservePageBreaks}
                onChange={(e) =>
                  onChangeWordSettings({ ...wordSettings, preservePageBreaks: e.target.checked })
                }
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <span>Conservar saltos de página originales</span>
            </label>
          </div>
        </div>
      )}

      {activeTool === 'batch-to-pdf' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => onChangeBatchConvertMode('single-pdf')}
              className={`p-3 rounded-lg border text-left transition-colors ${
                batchConvertMode === 'single-pdf'
                  ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-slate-900 dark:text-white'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="text-sm font-medium">Convertir todos en un solo PDF</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Une PDFs, Word (.docx) e imágenes en un documento continuo
              </div>
            </button>

            <button
              type="button"
              onClick={() => onChangeBatchConvertMode('separate-pdfs')}
              className={`p-3 rounded-lg border text-left transition-colors ${
                batchConvertMode === 'separate-pdfs'
                  ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-slate-900 dark:text-white'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              <div className="text-sm font-medium">Generar cada archivo en un PDF por separado</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Convierte cada archivo seleccionado manteniendo su nombre individual
              </div>
            </button>
          </div>

          {batchConvertMode === 'single-pdf' && (
            <label className="block max-w-md space-y-1.5">
              <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                Nombre del PDF unificado
              </span>
              <input
                type="text"
                value={batchOutputName}
                onChange={(e) => onChangeBatchOutputName(e.target.value)}
                placeholder="lote_convertido_unificado"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </label>
          )}
        </div>
      )}

      {activeTool === 'vault' && (
        <div className="space-y-4">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 max-w-md">
            <button
              type="button"
              onClick={() => onChangeVaultMode('encrypt')}
              className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                vaultMode === 'encrypt'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Cifrar en bóveda (.speedvault)
            </button>
            <button
              type="button"
              onClick={() => onChangeVaultMode('decrypt')}
              className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                vaultMode === 'decrypt'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Descifrar archivo (.speedvault)
            </button>
          </div>
        </div>
      )}

      {/* Local AES-256-GCM Encryption Security Footer */}
      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {activeTool !== 'vault' && (
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={encryptOutput}
                onChange={(e) => onChangeEncryptOutput(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 accent-blue-600"
              />
              <Lock className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Cifrar resultado con AES-256 local (.speedvault)</span>
            </label>
          )}

          {(activeTool === 'vault' || encryptOutput) && (
            <input
              type="password"
              value={vaultPassword}
              onChange={(e) => onChangeVaultPassword(e.target.value)}
              placeholder="Contraseña local (mín. 4 caracteres)"
              aria-label="Contraseña de cifrado local"
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 w-64 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          )}
        </div>

        <button
          type="button"
          disabled={isDisabled}
          onClick={onExecute}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Play className="w-4 h-4 shrink-0" />
          <span>{isProcessing ? 'Procesando...' : actionLabel}</span>
        </button>
      </div>
    </section>
  );
}
