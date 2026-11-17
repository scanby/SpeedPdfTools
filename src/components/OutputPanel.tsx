import JSZip from 'jszip';
import { Archive, CheckCircle2, Download, Eye, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes, formatReduction, triggerBlobDownload } from '../core/formatters';
import { ProcessedOutput, ProgressState } from '../types/speedpdf';

interface OutputPanelProps {
  progress: ProgressState;
  outputs: ProcessedOutput[];
  errorMessage: string | null;
  onDismissError: () => void;
  onDismissOutputs: () => void;
}

export function OutputPanel({
  progress,
  outputs,
  errorMessage,
  onDismissError,
  onDismissOutputs,
}: OutputPanelProps) {
  const [previewItem, setPreviewItem] = useState<ProcessedOutput | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!previewItem) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewItem.blob);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [previewItem]);

  const canPreview = (item: ProcessedOutput) =>
    !item.encrypted &&
    (item.mimeType === 'application/pdf' ||
      item.mimeType === 'image/jpeg' ||
      item.mimeType === 'image/png');

  const handleDownloadAllZip = async () => {
    const zip = new JSZip();
    outputs.forEach((item, index) => {
      const name = item.fileName || `archivo_${index + 1}.pdf`;
      zip.file(name, item.blob);
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(zipBlob, 'SPEED_PDF_resultados.zip');
  };

  return (
    <section className="space-y-4">
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 flex items-center justify-between gap-4 text-sm text-red-800 dark:text-red-200"
        >
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={onDismissError}
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/50"
            aria-label="Cerrar alerta"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {progress.active && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="font-medium text-slate-800 dark:text-slate-200">{progress.stage}</span>
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
              {progress.percent}%
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-transform duration-150 origin-left"
              style={{ transform: `scaleX(${Math.max(0.03, progress.percent / 100)})` }}
            />
          </div>
        </div>
      )}

      {outputs.length > 0 && (
        <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-white dark:bg-slate-900/70 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
              {outputs.length === 1 ? 'Archivo listo' : `${outputs.length} archivos listos`}
            </h3>
            <div className="flex items-center gap-2">
              {outputs.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    void handleDownloadAllZip();
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Descargar todos (.zip)</span>
                </button>
              )}
              <button
                type="button"
                onClick={onDismissOutputs}
                className="p-1 rounded-md text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar resultado"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {outputs.map((item) => {
              const delta = formatReduction(item.originalSize, item.outputSize);
              return (
                <li
                  key={item.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      {item.encrypted ? (
                        <Lock className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      )}
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.fileName}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      <span>{item.summary}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {formatBytes(item.originalSize)} → {formatBytes(item.outputSize)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          delta.isSmaller
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-slate-600 dark:text-slate-300'
                        }
                      >
                        {delta.label}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {canPreview(item) && (
                      <button
                        type="button"
                        onClick={() => setPreviewItem(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Vista previa</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => triggerBlobDownload(item.blob, item.fileName)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {previewItem && previewUrl && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Vista previa de ${previewItem.fileName}`}
          className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-4xl h-[82vh] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                  {previewItem.fileName}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatBytes(previewItem.outputSize)} · Vista previa local
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => triggerBlobDownload(previewItem.blob, previewItem.fileName)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Cerrar vista previa"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 bg-slate-100 dark:bg-slate-950 flex items-center justify-center overflow-auto p-4">
              {previewItem.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewUrl}
                  title={previewItem.fileName}
                  className="w-full h-full rounded border border-slate-200 dark:border-slate-800 bg-white"
                />
              ) : (
                <img
                  src={previewUrl}
                  alt={previewItem.fileName}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-full object-contain rounded shadow-sm"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
