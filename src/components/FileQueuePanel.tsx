import {
  FileImage,
  FileText,
  GripVertical,
  Lock,
  RotateCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { DragEvent, MouseEvent, useState } from 'react';
import { formatBytes } from '../core/formatters';
import { PdfToolId, QueueFileItem } from '../types/speedpdf';

const CARD_DRAG_MIME = 'application/x-speedpdf-card';

interface FileQueuePanelProps {
  activeTool: PdfToolId;
  items: QueueFileItem[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveItem: (id: string) => void;
  onReorderItem: (fromId: string, toId: string) => void;
  onRotateItem: (id: string, deltaDegrees?: number) => void;
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
  onReorderItem,
  onRotateItem,
  onUpdatePageRange,
  onClearAll,
  onLoadSample,
  acceptedHint,
}: FileQueuePanelProps) {
  const [isExternalDragging, setIsExternalDragging] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [dropTargetCardId, setDropTargetCardId] = useState<string | null>(null);

  const isInternalCardDrag = (e: DragEvent<HTMLElement>) =>
    Boolean(draggedCardId) || e.dataTransfer.types.includes(CARD_DRAG_MIME);

  const handleDropzoneDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (isInternalCardDrag(e)) return;
    e.preventDefault();
    setIsExternalDragging(true);
  };

  const handleDropzoneDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (isInternalCardDrag(e)) return;
    e.preventDefault();
    setIsExternalDragging(false);
  };

  const handleDropzoneDrop = (e: DragEvent<HTMLDivElement>) => {
    if (isInternalCardDrag(e)) return;
    e.preventDefault();
    setIsExternalDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const handleCardDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, input, select, textarea, a, label')) {
      e.preventDefault();
      return;
    }
    setDraggedCardId(id);
    setDropTargetCardId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(CARD_DRAG_MIME, id);
  };

  const handleCardDragOver = (e: DragEvent<HTMLDivElement>, id: string) => {
    if (!isInternalCardDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetCardId !== id) {
      setDropTargetCardId(id);
    }
  };

  const handleCardDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    if (!isInternalCardDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggedCardId || e.dataTransfer.getData(CARD_DRAG_MIME);
    if (sourceId && sourceId !== targetId) {
      onReorderItem(sourceId, targetId);
    }
    setDraggedCardId(null);
    setDropTargetCardId(null);
  };

  const handleCardDragEnd = () => {
    setDraggedCardId(null);
    setDropTargetCardId(null);
  };

  const stopInteractiveMouseDown = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  const totalBytes = items.reduce((acc, item) => acc + item.size, 0);

  return (
    <section className="space-y-4">
      <div
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={handleDropzoneDrop}
        className={`rounded-xl border border-dashed p-6 transition-colors ${
          isExternalDragging
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
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {items.length} {items.length === 1 ? 'archivo cargado' : 'archivos cargados'}
              </span>
              <span aria-hidden="true">·</span>
              <span>Peso total: {formatBytes(totalBytes)}</span>
              {items.length > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    Mantén pulsada cualquier tarjeta y arrástrala para ordenar
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={onClearAll}
              className="text-xs font-medium text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors whitespace-nowrap shrink-0"
            >
              Vaciar cola
            </button>
          </div>

          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3.5">
            {items.map((item, idx) => {
              const rotation = item.rotation ?? 0;
              const isSideways = rotation === 90 || rotation === 270;
              const isDragged = draggedCardId === item.id;
              const isDropTarget = dropTargetCardId === item.id && draggedCardId !== item.id;
              const canRotate = item.kind === 'pdf' || item.kind === 'image';

              return (
                <div
                  key={item.id}
                  draggable={items.length > 1}
                  onDragStart={(e) => handleCardDragStart(e, item.id)}
                  onDragOver={(e) => handleCardDragOver(e, item.id)}
                  onDrop={(e) => handleCardDrop(e, item.id)}
                  onDragEnd={handleCardDragEnd}
                  className={`group relative rounded-xl border bg-slate-50/70 dark:bg-slate-950/60 flex flex-col overflow-hidden transition-all select-none ${
                    items.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''
                  } ${
                    isDragged
                      ? 'opacity-45 scale-[0.98] border-blue-400 dark:border-blue-600'
                      : isDropTarget
                      ? 'border-blue-500 ring-2 ring-blue-500/70 bg-blue-50/40 dark:bg-blue-950/30 scale-[1.01]'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {/* Top card header: order badge + drag handle + remove */}
                  <div className="px-3 py-2 border-b border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between gap-2 bg-white/80 dark:bg-slate-900/70">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {items.length > 1 && (
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                      )}
                      <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded bg-slate-200/80 dark:bg-slate-800 text-slate-700 dark:text-slate-200 tabular-nums">
                        #{idx + 1}
                      </span>
                      {rotation !== 0 && (
                        <span className="inline-flex items-center px-1.5 py-0.5 text-[11px] font-mono font-semibold rounded bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 tabular-nums">
                          +{rotation}°
                        </span>
                      )}
                      {item.requiresPassword && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 truncate">
                          <Lock className="w-2.5 h-2.5 shrink-0" />
                          <span>Clave</span>
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onMouseDown={stopInteractiveMouseDown}
                      onClick={() => onRemoveItem(item.id)}
                      title="Quitar archivo"
                      aria-label={`Quitar ${item.name}`}
                      className="p-1 rounded-md text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* First-page visual preview */}
                  <div className="relative h-44 w-full bg-slate-100/90 dark:bg-slate-900/90 flex items-center justify-center p-3 overflow-hidden border-b border-slate-200/80 dark:border-slate-800/80">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={`Primera página de ${item.name}`}
                        referrerPolicy="no-referrer"
                        draggable={false}
                        style={{ transform: `rotate(${rotation}deg)` }}
                        className={`object-contain rounded shadow-sm border border-slate-200 dark:border-slate-700 bg-white transition-transform duration-200 pointer-events-none ${
                          isSideways ? 'max-w-[136px] max-h-[136px]' : 'max-w-full max-h-full'
                        }`}
                      />
                    ) : (
                      <div className="w-24 h-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-xs flex flex-col items-center justify-center gap-2 p-2">
                        {item.kind === 'image' ? (
                          <FileImage className="w-7 h-7 text-slate-400 dark:text-slate-500" />
                        ) : item.kind === 'vault' ? (
                          <Lock className="w-7 h-7 text-amber-500 dark:text-amber-400" />
                        ) : (
                          <FileText className="w-7 h-7 text-blue-500 dark:text-blue-400" />
                        )}
                        <span className="text-[10px] font-mono uppercase text-slate-500 dark:text-slate-400">
                          {item.kind}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Card details & per-file actions */}
                  <div className="p-3 flex-1 flex flex-col justify-between gap-2.5">
                    <div className="min-w-0">
                      <div
                        title={item.name}
                        className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate"
                      >
                        {item.name}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                        <span>{formatBytes(item.size)}</span>
                        {item.requiresPassword ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-amber-700 dark:text-amber-300 font-medium">
                              Clave requerida
                            </span>
                          </>
                        ) : (
                          typeof item.pageCount === 'number' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {item.pageCount} {item.pageCount === 1 ? 'pág.' : 'págs.'}
                              </span>
                            </>
                          )
                        )}
                        <span aria-hidden="true">·</span>
                        <span className="uppercase font-mono">{item.kind}</span>
                      </div>
                    </div>

                    {(activeTool === 'merge' || activeTool === 'rotate') && item.kind === 'pdf' && (
                      <label
                        onMouseDown={stopInteractiveMouseDown}
                        className="flex items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400"
                      >
                        <span className="whitespace-nowrap">Páginas:</span>
                        <input
                          type="text"
                          value={item.pageRange}
                          onChange={(e) => onUpdatePageRange(item.id, e.target.value)}
                          placeholder="Todas"
                          aria-label={`Rango de páginas para ${item.name}`}
                          className="w-24 px-2 py-1 text-[11px] font-mono rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </label>
                    )}

                    {canRotate && (
                      <button
                        type="button"
                        onMouseDown={stopInteractiveMouseDown}
                        onClick={() => onRotateItem(item.id, 90)}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
                      >
                        <RotateCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                        <span>Girar 90°</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
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
