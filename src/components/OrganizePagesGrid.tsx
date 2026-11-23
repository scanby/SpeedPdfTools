import {
  ArrowLeft,
  ArrowRight,
  FilePlus2,
  GripVertical,
  Layers,
  Loader2,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { ChangeEvent, DragEvent, MouseEvent, useMemo, useRef, useState } from 'react';
import { formatBytes } from '../core/formatters';
import { OrganizerPageItem, OrganizerSourceFile } from '../types/speedpdf';

const ORG_PAGE_DRAG_MIME = 'application/x-speedpdf-org-page';

export interface FileColorTheme {
  label: string;
  swatchBg: string;
  cardBg: string;
  cardBorder: string;
  headerBg: string;
  headerText: string;
  mutedText: string;
  legendCard: string;
}

export const ORGANIZER_FILE_COLORS: FileColorTheme[] = [
  {
    label: 'Amarillo',
    swatchBg: 'bg-amber-400 border-amber-500',
    cardBg: 'bg-amber-50/90 dark:bg-amber-950/30',
    cardBorder: 'border-amber-300 dark:border-amber-700/80',
    headerBg: 'bg-amber-100/95 dark:bg-amber-900/45 border-amber-200/90 dark:border-amber-800/70',
    headerText: 'text-amber-950 dark:text-amber-100',
    mutedText: 'text-amber-800/90 dark:text-amber-300',
    legendCard: 'bg-amber-50 border-amber-300 text-amber-950 dark:bg-amber-950/35 dark:border-amber-700/80 dark:text-amber-100',
  },
  {
    label: 'Azul pastel',
    swatchBg: 'bg-sky-300 border-sky-500',
    cardBg: 'bg-sky-50/95 dark:bg-sky-950/30',
    cardBorder: 'border-sky-300 dark:border-sky-700/80',
    headerBg: 'bg-sky-100/95 dark:bg-sky-900/45 border-sky-200/90 dark:border-sky-800/70',
    headerText: 'text-sky-950 dark:text-sky-100',
    mutedText: 'text-sky-800/90 dark:text-sky-300',
    legendCard: 'bg-sky-50 border-sky-300 text-sky-950 dark:bg-sky-950/35 dark:border-sky-700/80 dark:text-sky-100',
  },
  {
    label: 'Menta pastel',
    swatchBg: 'bg-emerald-300 border-emerald-500',
    cardBg: 'bg-emerald-50/90 dark:bg-emerald-950/30',
    cardBorder: 'border-emerald-300 dark:border-emerald-700/80',
    headerBg: 'bg-emerald-100/95 dark:bg-emerald-900/45 border-emerald-200/90 dark:border-emerald-800/70',
    headerText: 'text-emerald-950 dark:text-emerald-100',
    mutedText: 'text-emerald-800/90 dark:text-emerald-300',
    legendCard: 'bg-emerald-50 border-emerald-300 text-emerald-950 dark:bg-emerald-950/35 dark:border-emerald-700/80 dark:text-emerald-100',
  },
  {
    label: 'Rosa pastel',
    swatchBg: 'bg-rose-300 border-rose-500',
    cardBg: 'bg-rose-50/90 dark:bg-rose-950/30',
    cardBorder: 'border-rose-300 dark:border-rose-700/80',
    headerBg: 'bg-rose-100/95 dark:bg-rose-900/45 border-rose-200/90 dark:border-rose-800/70',
    headerText: 'text-rose-950 dark:text-rose-100',
    mutedText: 'text-rose-800/90 dark:text-rose-300',
    legendCard: 'bg-rose-50 border-rose-300 text-rose-950 dark:bg-rose-950/35 dark:border-rose-700/80 dark:text-rose-100',
  },
  {
    label: 'Lavanda pastel',
    swatchBg: 'bg-violet-300 border-violet-500',
    cardBg: 'bg-violet-50/90 dark:bg-violet-950/30',
    cardBorder: 'border-violet-300 dark:border-violet-700/80',
    headerBg: 'bg-violet-100/95 dark:bg-violet-900/45 border-violet-200/90 dark:border-violet-800/70',
    headerText: 'text-violet-950 dark:text-violet-100',
    mutedText: 'text-violet-800/90 dark:text-violet-300',
    legendCard: 'bg-violet-50 border-violet-300 text-violet-950 dark:bg-violet-950/35 dark:border-violet-700/80 dark:text-violet-100',
  },
  {
    label: 'Durazno pastel',
    swatchBg: 'bg-orange-300 border-orange-500',
    cardBg: 'bg-orange-50/90 dark:bg-orange-950/30',
    cardBorder: 'border-orange-300 dark:border-orange-700/80',
    headerBg: 'bg-orange-100/95 dark:bg-orange-900/45 border-orange-200/90 dark:border-orange-800/70',
    headerText: 'text-orange-950 dark:text-orange-100',
    mutedText: 'text-orange-800/90 dark:text-orange-300',
    legendCard: 'bg-orange-50 border-orange-300 text-orange-950 dark:bg-orange-950/35 dark:border-orange-700/80 dark:text-orange-100',
  },
  {
    label: 'Cian pastel',
    swatchBg: 'bg-cyan-300 border-cyan-500',
    cardBg: 'bg-cyan-50/90 dark:bg-cyan-950/30',
    cardBorder: 'border-cyan-300 dark:border-cyan-700/80',
    headerBg: 'bg-cyan-100/95 dark:bg-cyan-900/45 border-cyan-200/90 dark:border-cyan-800/70',
    headerText: 'text-cyan-950 dark:text-cyan-100',
    mutedText: 'text-cyan-800/90 dark:text-cyan-300',
    legendCard: 'bg-cyan-50 border-cyan-300 text-cyan-950 dark:bg-cyan-950/35 dark:border-cyan-700/80 dark:text-cyan-100',
  },
  {
    label: 'Lima pastel',
    swatchBg: 'bg-lime-300 border-lime-500',
    cardBg: 'bg-lime-50/90 dark:bg-lime-950/30',
    cardBorder: 'border-lime-300 dark:border-lime-700/80',
    headerBg: 'bg-lime-100/95 dark:bg-lime-900/45 border-lime-200/90 dark:border-lime-800/70',
    headerText: 'text-lime-950 dark:text-lime-100',
    mutedText: 'text-lime-800/90 dark:text-lime-300',
    legendCard: 'bg-lime-50 border-lime-300 text-lime-950 dark:bg-lime-950/35 dark:border-lime-700/80 dark:text-lime-100',
  },
];

export function getFileColorTheme(colorIndex: number): FileColorTheme {
  return ORGANIZER_FILE_COLORS[((colorIndex % ORGANIZER_FILE_COLORS.length) + ORGANIZER_FILE_COLORS.length) % ORGANIZER_FILE_COLORS.length];
}

interface OrganizePagesGridProps {
  sourceFiles: OrganizerSourceFile[];
  pages: OrganizerPageItem[];
  isLoadingThumbnails: boolean;
  onAddPdfFiles: (files: FileList | File[]) => void;
  onReorderPage: (fromId: string, toId: string) => void;
  onMovePageStep: (id: string, delta: -1 | 1) => void;
  onRotatePage: (id: string, deltaDegrees?: number) => void;
  onRotateFilePages: (sourceFileId: string, deltaDegrees?: number) => void;
  onRemovePage: (id: string) => void;
  onRemoveFile: (sourceFileId: string) => void;
  onGroupByFile: () => void;
  onResetAllPages: () => void;
  onClearAll: () => void;
  onLoadSample: () => void;
}

export function OrganizePagesGrid({
  sourceFiles,
  pages,
  isLoadingThumbnails,
  onAddPdfFiles,
  onReorderPage,
  onMovePageStep,
  onRotatePage,
  onRotateFilePages,
  onRemovePage,
  onRemoveFile,
  onGroupByFile,
  onResetAllPages,
  onClearAll,
  onLoadSample,
}: OrganizePagesGridProps) {
  const [isExternalDragging, setIsExternalDragging] = useState(false);
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dropTargetPageId, setDropTargetPageId] = useState<string | null>(null);
  const addPdfInputRef = useRef<HTMLInputElement | null>(null);

  const filePageTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const sf of sourceFiles) {
      map.set(sf.id, sf.pageCount);
    }
    return map;
  }, [sourceFiles]);

  const activeCountByFile = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of pages) {
      map.set(p.sourceFileId, (map.get(p.sourceFileId) ?? 0) + 1);
    }
    return map;
  }, [pages]);

  const isInternalPageDrag = (e: DragEvent<HTMLElement>) =>
    Boolean(draggedPageId) || e.dataTransfer.types.includes(ORG_PAGE_DRAG_MIME);

  const handleDropzoneDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (isInternalPageDrag(e)) return;
    e.preventDefault();
    setIsExternalDragging(true);
  };

  const handleDropzoneDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (isInternalPageDrag(e)) return;
    e.preventDefault();
    setIsExternalDragging(false);
  };

  const handleDropzoneDrop = (e: DragEvent<HTMLDivElement>) => {
    if (isInternalPageDrag(e)) return;
    e.preventDefault();
    setIsExternalDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddPdfFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddPdfFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleCardDragStart = (e: DragEvent<HTMLDivElement>, id: string) => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('button, input, select, textarea, a, label')) {
      e.preventDefault();
      return;
    }
    setDraggedPageId(id);
    setDropTargetPageId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(ORG_PAGE_DRAG_MIME, id);
  };

  const handleCardDragOver = (e: DragEvent<HTMLDivElement>, id: string) => {
    if (!isInternalPageDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetPageId !== id) {
      setDropTargetPageId(id);
    }
  };

  const handleCardDrop = (e: DragEvent<HTMLDivElement>, targetId: string) => {
    if (!isInternalPageDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const sourceId = draggedPageId || e.dataTransfer.getData(ORG_PAGE_DRAG_MIME);
    if (sourceId && sourceId !== targetId) {
      onReorderPage(sourceId, targetId);
    }
    setDraggedPageId(null);
    setDropTargetPageId(null);
  };

  const handleCardDragEnd = () => {
    setDraggedPageId(null);
    setDropTargetPageId(null);
  };

  const stopInteractiveMouseDown = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
  };

  const totalBytes = sourceFiles.reduce((acc, sf) => acc + sf.size, 0);
  const completedThumbs = useMemo(
    () =>
      pages.filter((p) => Boolean(p.thumbnailUrl) || p.thumbnailStatus === 'failed').length,
    [pages]
  );

  return (
    <section className="space-y-4">
      <input
        ref={addPdfInputRef}
        type="file"
        multiple
        accept=".pdf,application/pdf"
        onChange={handleFileInputChange}
        className="sr-only"
      />

      {/* PDF Dropzone & Add files bar */}
      <div
        onDragOver={handleDropzoneDragOver}
        onDragLeave={handleDropzoneDragLeave}
        onDrop={handleDropzoneDrop}
        className={`rounded-xl border border-dashed p-5 transition-colors ${
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
                Arrastra uno o varios archivos PDF aquí para ordenar o mezclar sus páginas
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Cada PDF recibe un color propio (Amarillo, Azul pastel, Menta...) y numera sus páginas para que puedas mezclarlas sin perder el rastro.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => addPdfInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <FilePlus2 className="w-3.5 h-3.5" />
              <span>{sourceFiles.length > 0 ? 'Agregar otro PDF' : 'Seleccionar PDFs'}</span>
            </button>

            <button
              type="button"
              onClick={onLoadSample}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span>Cargar muestra (2 PDFs)</span>
            </button>
          </div>
        </div>
      </div>

      {sourceFiles.length > 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
          {/* Header summary & global organizer controls */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {pages.length} {pages.length === 1 ? 'página' : 'páginas'} en orden
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {sourceFiles.length} {sourceFiles.length === 1 ? 'archivo PDF' : 'archivos PDF'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{formatBytes(totalBytes)}</span>
              {isLoadingThumbnails && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1.5 text-blue-600 dark:text-blue-400 font-medium tabular-nums">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generando miniaturas ({completedThumbs}/{pages.length})...
                  </span>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {sourceFiles.length > 1 && pages.length > 1 && (
                <button
                  type="button"
                  onClick={onGroupByFile}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <Layers className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Agrupar por color</span>
                </button>
              )}
              <button
                type="button"
                onClick={onResetAllPages}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restablecer páginas</span>
              </button>
              <button
                type="button"
                onClick={onClearAll}
                className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors whitespace-nowrap shrink-0"
              >
                Vaciar todo
              </button>
            </div>
          </div>

          {/* Color legend per loaded PDF file */}
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Archivos agrupados por color
              </span>
              <span>
                Arrastra cualquier miniatura para reordenar o mezclar páginas entre archivos
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {sourceFiles.map((sf) => {
                const color = getFileColorTheme(sf.colorIndex);
                const activeCount = activeCountByFile.get(sf.id) ?? 0;

                return (
                  <div
                    key={sf.id}
                    className={`inline-flex items-center gap-2.5 pl-2.5 pr-1.5 py-1.5 rounded-lg border text-xs ${color.legendCard}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-3 h-3 rounded-sm border shrink-0 ${color.swatchBg}`}
                    />
                    <div className="min-w-0 flex items-center gap-1.5">
                      <span title={sf.name} className="font-semibold max-w-[180px] truncate">
                        {sf.name}
                      </span>
                      <span className="opacity-80 tabular-nums whitespace-nowrap">
                        · {activeCount}/{sf.pageCount} págs. ({color.label})
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5 pl-1 border-l border-current/15 shrink-0">
                      <button
                        type="button"
                        onClick={() => onRotateFilePages(sf.id, 90)}
                        disabled={activeCount === 0}
                        title={`Girar +90° todas las páginas de ${sf.name}`}
                        aria-label={`Girar 90 grados todas las páginas de ${sf.name}`}
                        className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 transition-colors"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveFile(sf.id)}
                        title={`Quitar archivo ${sf.name}`}
                        aria-label={`Quitar archivo ${sf.name}`}
                        className="p-1 rounded hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Page thumbnail grid */}
          {pages.length > 0 ? (
            <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3.5">
              {pages.map((page, idx) => {
                const color = getFileColorTheme(page.colorIndex);
                const fileTotalPages = filePageTotals.get(page.sourceFileId) ?? page.originalPageNumber;
                const isSideways = page.rotation === 90 || page.rotation === 270;
                const isDragged = draggedPageId === page.id;
                const isDropTarget = dropTargetPageId === page.id && draggedPageId !== page.id;

                return (
                  <div
                    key={page.id}
                    draggable={pages.length > 1}
                    onDragStart={(e) => handleCardDragStart(e, page.id)}
                    onDragOver={(e) => handleCardDragOver(e, page.id)}
                    onDrop={(e) => handleCardDrop(e, page.id)}
                    onDragEnd={handleCardDragEnd}
                    className={`group relative rounded-xl border flex flex-col overflow-hidden transition-all select-none ${
                      pages.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''
                    } ${color.cardBg} ${
                      isDragged
                        ? 'opacity-45 scale-[0.98] border-blue-500'
                        : isDropTarget
                        ? 'border-blue-600 ring-2 ring-blue-500/80 scale-[1.02]'
                        : `${color.cardBorder} hover:brightness-[0.99] dark:hover:brightness-105`
                    }`}
                  >
                    {/* Colored per-file top header with original page number */}
                    <div
                      className={`px-2.5 py-2 border-b flex items-center justify-between gap-1.5 ${color.headerBg}`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {pages.length > 1 && (
                          <GripVertical className={`w-3.5 h-3.5 shrink-0 opacity-70 ${color.headerText}`} />
                        )}
                        <span
                          aria-hidden="true"
                          className={`w-2.5 h-2.5 rounded-sm border shrink-0 ${color.swatchBg}`}
                        />
                        <span className={`text-xs font-bold tabular-nums whitespace-nowrap ${color.headerText}`}>
                          Pág. {page.originalPageNumber}
                        </span>
                        <span className={`text-[11px] tabular-nums whitespace-nowrap ${color.mutedText}`}>
                          /{fileTotalPages}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {page.rotation !== 0 && (
                          <span className="text-[10px] font-mono font-semibold px-1 py-0.5 rounded bg-blue-600 text-white tabular-nums">
                            +{page.rotation}°
                          </span>
                        )}
                        <button
                          type="button"
                          onMouseDown={stopInteractiveMouseDown}
                          onClick={() => onRemovePage(page.id)}
                          title="Eliminar página"
                          aria-label={`Eliminar página ${page.originalPageNumber} de ${page.sourceFileName}`}
                          className={`p-1 rounded hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300 transition-colors ${color.headerText}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Miniature preview */}
                    <div className="relative h-40 w-full bg-white/80 dark:bg-slate-950/75 flex items-center justify-center p-2.5 overflow-hidden">
                      {page.thumbnailUrl ? (
                        <img
                          src={page.thumbnailUrl}
                          alt={`${page.sourceFileName} página ${page.originalPageNumber}`}
                          referrerPolicy="no-referrer"
                          draggable={false}
                          style={{ transform: `rotate(${page.rotation}deg)` }}
                          className={`object-contain rounded shadow-sm border border-slate-200 dark:border-slate-700 bg-white transition-transform duration-200 pointer-events-none ${
                            isSideways ? 'max-w-[116px] max-h-[116px]' : 'max-w-full max-h-full'
                          }`}
                        />
                      ) : page.thumbnailStatus === 'failed' ? (
                        <div className="w-24 h-28 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center text-center px-2 gap-1">
                          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                            Vista no disponible
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                            Pág. {page.originalPageNumber}
                          </span>
                        </div>
                      ) : (
                        <div className="w-20 h-28 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 animate-pulse flex items-center justify-center">
                          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                            {page.originalPageNumber}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Footer: source name, final order index, rotate 90° & fine reorder arrows */}
                    <div className="p-2.5 border-t border-black/5 dark:border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span
                          title={page.sourceFileName}
                          className={`font-medium truncate ${color.headerText}`}
                        >
                          {page.sourceFileName}
                        </span>
                        <span className="font-mono font-semibold tabular-nums whitespace-nowrap shrink-0 text-slate-700 dark:text-slate-200">
                          Orden #{idx + 1}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onMouseDown={stopInteractiveMouseDown}
                          disabled={idx === 0}
                          onClick={() => onMovePageStep(page.id, -1)}
                          title="Mover una posición a la izquierda"
                          aria-label={`Mover página a posición ${idx}`}
                          className="p-1.5 rounded-md border border-black/10 dark:border-white/15 bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-35 transition-colors"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>

                        <button
                          type="button"
                          onMouseDown={stopInteractiveMouseDown}
                          onClick={() => onRotatePage(page.id, 90)}
                          title="Girar esta página +90°"
                          className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-black/10 dark:border-white/15 bg-white/85 dark:bg-slate-900/80 text-slate-800 dark:text-slate-100 hover:bg-white dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                        >
                          <RotateCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                          <span>Girar 90°</span>
                        </button>

                        <button
                          type="button"
                          onMouseDown={stopInteractiveMouseDown}
                          disabled={idx === pages.length - 1}
                          onClick={() => onMovePageStep(page.id, 1)}
                          title="Mover una posición a la derecha"
                          aria-label={`Mover página a posición ${idx + 2}`}
                          className="p-1.5 rounded-md border border-black/10 dark:border-white/15 bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-35 transition-colors"
                        >
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Se eliminaron todas las páginas de la cuadrícula
              </p>
              <button
                type="button"
                onClick={onResetAllPages}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar páginas de los PDFs cargados</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white/60 dark:bg-slate-900/30 px-6 py-8 text-center">
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Carga uno o más PDFs para ver sus páginas en cuadrícula por color
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Puedes probar al instante con &ldquo;Cargar muestra (2 PDFs)&rdquo; para ver un archivo en amarillo y otro en azul pastel.
          </p>
        </div>
      )}
    </section>
  );
}
