import { ArrowDown, ArrowUp, FileImage, FileText, Lock, Sparkles, Trash2, Upload } from 'lucide-react';
import { DragEvent, useState } from 'react';
import { formatBytes } from '../core/formatters';
import { PdfToolId, QueueFileItem } from '../types/speedpdf';

interface FileQueuePanelProps {
  activeTool: PdfToolId;
  items: QueueFileItem[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveItem: (id: string) => void;
  onMoveItem: (id: string, direction: 'up' | 'down') => void;
  onUpdatePageRange: (id: string, pageRange: string) => void;
  onClearAll: () => void;
  onLoadSample: () => void;
  acceptedHint: string;
}

export function FileQueuePanel({
  activeTool,
  items,
  onAddFiles,
  onRemoveItem,
  onMoveItem,
  onUpdatePageRange,
  onClearAll,
  onLoadSample,
  acceptedHint,
}: FileQueuePanelProps) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const totalBytes = items.reduce((acc, item) => acc + item.size, 0);

  return (
    <section className="space-y-4">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-xl border border-dashed p-6 transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/30'
            : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-slate-400 dark:hover:border-slate-600'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0">
              <Upload className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                Arrastra y suelta tus archivos aquí para procesarlos en el dispositivo
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {acceptedHint} · Optimizado para archivos grandes por lotes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onLoadSample}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Cargar muestra</span>
            </button>
          </div>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {items.length} {items.length === 1 ? 'archivo en cola' : 'archivos en cola'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Peso total: {formatBytes(totalBytes)}</span>
            </div>

            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-medium text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors whitespace-nowrap shrink-0"
            >
              Vaciar cola
            </button>
          </div>

          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.map((item, idx) => (
              <li
                key={item.id}
                className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={`Vista previa de ${item.name}`}
                      referrerPolicy="no-referrer"
                      className="w-10 h-12 object-cover rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-12 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      {item.kind === 'image' ? (
                        <FileImage className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      ) : item.kind === 'vault' ? (
                        <Lock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      ) : (
                        <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                      )}
                    </div>
                  )}

                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                      {item.name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                      <span>{formatBytes(item.size)}</span>
                      {typeof item.pageCount === 'number' && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>
                            {item.pageCount} {item.pageCount === 1 ? 'página' : 'páginas'}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span className="uppercase font-mono">{item.kind}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  {activeTool === 'merge' && item.kind === 'pdf' && (
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                      <span className="whitespace-nowrap">Páginas:</span>
                      <input
                        type="text"
                        value={item.pageRange}
                        onChange={(e) => onUpdatePageRange(item.id, e.target.value)}
                        placeholder="Todas"
                        aria-label={`Rango de páginas para ${item.name}`}
                        className="w-24 px-2 py-1 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </label>
                  )}

                  {(activeTool === 'merge' || activeTool === 'img-to-pdf' || activeTool === 'batch-to-pdf') &&
                    items.length > 1 && (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onMoveItem(item.id, 'up')}
                        disabled={idx === 0}
                        title="Subir en el orden"
                        className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onMoveItem(item.id, 'down')}
                        disabled={idx === items.length - 1}
                        title="Bajar en el orden"
                        className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-35 transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    title="Quitar archivo"
                    className="p-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/30 px-6 py-8 text-center">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            No hay archivos cargados todavía
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Usa &ldquo;Cargar archivos&rdquo; en la barra superior, arrastra documentos o pulsa &ldquo;Cargar muestra&rdquo; para probar al instante.
          </p>
        </div>
      )}
    </section>
  );
}
