import {
  CheckSquare,
  ChevronRight,
  Download,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  Layers,
  Minimize2,
  MousePointerClick,
  SlidersHorizontal,
  Square,
  Zap,
} from 'lucide-react';
import { MouseEvent, useEffect, useMemo, useState } from 'react';
import { formatBytes, triggerBlobDownload } from '../core/formatters';
import {
  generateInstallRegistryScript,
  generateShellDispatcherScript,
  generateUninstallRegistryScript,
} from '../core/windowsShell';
import { ExplorerSimFile, WindowsTargetVersion } from '../types/speedpdf';

export type ContextMenuActionType =
  | 'auto-to-pdf'
  | 'auto-compress'
  | 'custom-compress'
  | 'merge-selected'
  | 'merge-images'
  | 'auto-to-word'
  | 'auto-to-jpg'
  | 'open-custom';

interface WindowsExplorerViewProps {
  onExecuteContextAction: (action: ContextMenuActionType, files: ExplorerSimFile[]) => void;
}

const INITIAL_SIM_FILES: ExplorerSimFile[] = [
  {
    id: 'sim-1',
    name: 'Informe_Corporativo_2026.pdf',
    extension: 'pdf',
    size: 4_820_400,
    modified: '15/11/2026 11:42',
  },
  {
    id: 'sim-2',
    name: 'Anexo_Financiero.pdf',
    extension: 'pdf',
    size: 2_310_120,
    modified: '15/11/2026 11:45',
  },
  {
    id: 'sim-3',
    name: 'Propuesta_Comercial.docx',
    extension: 'docx',
    size: 684_500,
    modified: '14/11/2026 17:18',
  },
  {
    id: 'sim-4',
    name: 'Portada_AltaRes.jpg',
    extension: 'jpg',
    size: 1_940_000,
    modified: '14/11/2026 09:05',
  },
  {
    id: 'sim-5',
    name: 'Esquema_Firma.png',
    extension: 'png',
    size: 920_300,
    modified: '13/11/2026 16:30',
  },
];

export function WindowsExplorerView({ onExecuteContextAction }: WindowsExplorerViewProps) {
  const [windowsVersion, setWindowsVersion] = useState<WindowsTargetVersion>('win11');
  const [simFiles, setSimFiles] = useState<ExplorerSimFile[]>(INITIAL_SIM_FILES);
  const [selectedIds, setSelectedIds] = useState<string[]>(['sim-1']);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  // Registry Configurator State
  const [installPath, setInstallPath] = useState('C:\\Program Files\\SPEED.PDF\\speedpdf.exe');
  const [enableAutoConvert, setEnableAutoConvert] = useState(true);
  const [enableCustomCompress, setEnableCustomCompress] = useState(true);
  const [enableMergeSelected, setEnableMergeSelected] = useState(true);
  const [enablePdfToWord, setEnablePdfToWord] = useState(true);
  const [activeScriptTab, setActiveScriptTab] = useState<'install' | 'uninstall' | 'ipc'>('install');

  useEffect(() => {
    const closeMenu = () => setMenuPos(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const selectedFiles = useMemo(
    () => simFiles.filter((f) => selectedIds.includes(f.id)),
    [simFiles, selectedIds]
  );

  const toggleSelect = (id: string, multi: boolean) => {
    if (multi) {
      setSelectedIds((prev) =>
        prev.includes(id) ? (prev.length > 1 ? prev.filter((item) => item !== id) : prev) : [...prev, id]
      );
    } else {
      setSelectedIds([id]);
    }
  };

  const handleRowContextMenu = (e: MouseEvent, fileId: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(fileId)) {
      setSelectedIds([fileId]);
    }
    const maxX = Math.min(e.clientX, window.innerWidth - 310);
    const maxY = Math.min(e.clientY, window.innerHeight - 280);
    setMenuPos({ x: Math.max(12, maxX), y: Math.max(12, maxY) });
  };

  const handleOpenMenuFromButton = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenuPos({
      x: Math.min(rect.left, window.innerWidth - 310),
      y: Math.min(rect.bottom + 8, window.innerHeight - 280),
    });
  };

  const handleAddRealFilesToSim = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const added: ExplorerSimFile[] = [];
    Array.from(fileList).forEach((file) => {
      const lower = file.name.toLowerCase();
      const ext: ExplorerSimFile['extension'] | null = lower.endsWith('.pdf')
        ? 'pdf'
        : lower.endsWith('.docx')
        ? 'docx'
        : lower.endsWith('.png')
        ? 'png'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'jpg'
        : null;
      if (!ext) return;
      added.push({
        id: `real-${crypto.randomUUID()}`,
        name: file.name,
        extension: ext,
        size: file.size,
        modified: new Date(file.lastModified).toLocaleDateString('es-ES'),
        realFile: file,
      });
    });

    if (added.length > 0) {
      setSimFiles((prev) => [...added, ...prev]);
      setSelectedIds(added.map((a) => a.id));
    }
  };

  const registryPreview = useMemo(() => {
    if (activeScriptTab === 'install') {
      return generateInstallRegistryScript({
        targetWindows: windowsVersion,
        installPath,
        enableAutoConvert,
        enableCustomCompress,
        enableMergeSelected,
        enablePdfToWord,
      });
    }
    if (activeScriptTab === 'uninstall') {
      return generateUninstallRegistryScript();
    }
    return generateShellDispatcherScript();
  }, [
    activeScriptTab,
    windowsVersion,
    installPath,
    enableAutoConvert,
    enableCustomCompress,
    enableMergeSelected,
    enablePdfToWord,
  ]);

  const contextMenuOptions = useMemo(() => {
    const count = selectedFiles.length;
    if (count === 0) return [];
    const allPdf = selectedFiles.every((f) => f.extension === 'pdf');
    const allImg = selectedFiles.every((f) => f.extension === 'jpg' || f.extension === 'png');
    const single = count === 1 ? selectedFiles[0] : null;

    const actions: {
      id: ContextMenuActionType;
      label: string;
      icon: typeof Zap;
      highlight?: boolean;
    }[] = [];

    if (single) {
      if (single.extension === 'pdf') {
        actions.push(
          {
            id: 'auto-compress',
            label: 'SPEED.PDF: Comprimir automáticamente',
            icon: Zap,
            highlight: true,
          },
          {
            id: 'custom-compress',
            label: 'SPEED.PDF: Personalizar compresión...',
            icon: SlidersHorizontal,
          },
          {
            id: 'auto-to-word',
            label: 'SPEED.PDF: Convertir a Word (.docx)',
            icon: FileText,
          },
          {
            id: 'auto-to-jpg',
            label: 'SPEED.PDF: Convertir páginas a JPG',
            icon: FileImage,
          }
        );
      } else {
        actions.push(
          {
            id: 'auto-to-pdf',
            label: 'SPEED.PDF: Convertir a PDF automáticamente',
            icon: Zap,
            highlight: true,
          },
          {
            id: 'open-custom',
            label: 'SPEED.PDF: Abrir y ajustar formato...',
            icon: SlidersHorizontal,
          }
        );
      }
    } else {
      if (allPdf) {
        actions.push(
          {
            id: 'merge-selected',
            label: `SPEED.PDF: Unir ${count} PDFs seleccionados`,
            icon: Layers,
            highlight: true,
          },
          {
            id: 'custom-compress',
            label: `SPEED.PDF: Comprimir lote (${count} archivos)...`,
            icon: Minimize2,
          }
        );
      } else if (allImg) {
        actions.push(
          {
            id: 'merge-images',
            label: `SPEED.PDF: Convertir ${count} imágenes a PDF`,
            icon: Layers,
            highlight: true,
          },
          {
            id: 'open-custom',
            label: 'SPEED.PDF: Configurar márgenes y página...',
            icon: SlidersHorizontal,
          }
        );
      } else {
        actions.push({
          id: 'open-custom',
          label: `SPEED.PDF: Abrir ${count} archivos en estación`,
          icon: SlidersHorizontal,
          highlight: true,
        });
      }
    }

    return actions;
  }, [selectedFiles]);

  const winFrameTitle =
    windowsVersion === 'win11'
      ? 'Explorador de archivos (Windows 11)'
      : windowsVersion === 'win10'
      ? 'Explorador de archivos (Windows 10)'
      : 'Explorador de Windows (Windows 7)';

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-8">
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
            Integración con el menú contextual de Windows 7–11
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            Simula el clic derecho sobre uno o varios archivos en el explorador para ejecutar acciones directas, y descarga los scripts reales de registro para instalar SPEED.PDF en Windows.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shrink-0 self-start">
          {(
            [
              { id: 'win11', label: 'Windows 11' },
              { id: 'win10', label: 'Windows 10' },
              { id: 'win7', label: 'Windows 7' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setWindowsVersion(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                windowsVersion === item.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Simulated Windows Explorer */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <Folder className="w-4 h-4 text-amber-500 shrink-0" />
            <span className="font-medium">{winFrameTitle}</span>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            <span className="font-mono text-slate-500 dark:text-slate-400">
              C:\Users\Documentos\Contratos_2026
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer whitespace-nowrap shrink-0">
              <span>Agregar archivo propio</span>
              <input
                type="file"
                multiple
                accept=".pdf,.docx,.jpg,.jpeg,.png"
                onChange={(e) => handleAddRealFilesToSim(e.target.files)}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              onClick={handleOpenMenuFromButton}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>Simular clic derecho ({selectedIds.length})</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/40">
                <th className="py-2.5 pl-4 pr-2 w-10">Sel.</th>
                <th className="py-2.5 px-3">Nombre</th>
                <th className="py-2.5 px-3">Fecha de modificación</th>
                <th className="py-2.5 px-3">Tipo</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Tamaño</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-sm">
              {simFiles.map((file) => {
                const isSelected = selectedIds.includes(file.id);
                return (
                  <tr
                    key={file.id}
                    onClick={(e) => toggleSelect(file.id, e.ctrlKey || e.metaKey)}
                    onContextMenu={(e) => handleRowContextMenu(e, file.id)}
                    className={`cursor-pointer select-none transition-colors ${
                      isSelected
                        ? 'bg-blue-50/90 dark:bg-blue-950/40 text-slate-950 dark:text-white'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <td
                      className="py-2.5 pl-4 pr-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(file.id, true);
                      }}
                    >
                      {isSelected ? (
                        <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-medium">
                      <div className="flex items-center gap-2.5">
                        {file.extension === 'jpg' || file.extension === 'png' ? (
                          <FileImage className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
                        )}
                        <span className="truncate">{file.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {file.modified}
                    </td>
                    <td className="py-2.5 px-3 text-xs font-mono uppercase text-slate-500 dark:text-slate-400">
                      {file.extension}
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-xs text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {formatBytes(file.size)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
          <span>
            Consejo: haz clic derecho sobre cualquier fila o usa Ctrl+Clic / casillas para seleccionar múltiples archivos.
          </span>
          <span className="tabular-nums">
            {simFiles.length} elementos · {selectedIds.length} seleccionado(s)
          </span>
        </div>
      </section>

      {/* Floating Simulated Windows Context Menu */}
      {menuPos && (
        <div
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ left: menuPos.x, top: menuPos.y }}
          className={`fixed z-50 w-76 py-1.5 shadow-xl border ${
            windowsVersion === 'win11'
              ? 'rounded-xl border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md'
              : windowsVersion === 'win10'
              ? 'rounded-sm border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900'
              : 'rounded-none border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-800'
          }`}
        >
          <div className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 mb-1">
            Menú contextual ({windowsVersion.toUpperCase()})
          </div>

          {contextMenuOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuPos(null);
                  onExecuteContextAction(opt.id, selectedFiles);
                }}
                className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors ${
                  opt.highlight
                    ? 'font-medium text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/60'
                    : 'text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{opt.label}</span>
              </button>
            );
          })}

          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
          <div className="px-3 py-1.5 text-xs text-slate-400 dark:text-slate-500">
            Abrir con · Copiar · Propiedades
          </div>
        </div>
      )}

      {/* Real Windows Registry & IPC Generator */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 space-y-4">
          <div>
            <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
              Generador de registro para Windows (.reg)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Configura las entradas bajo <code className="font-mono">HKCU\Software\Classes</code> sin requerir permisos de administrador.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Ruta del ejecutable de escritorio
            </span>
            <input
              type="text"
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </label>

          <div className="space-y-2.5 text-xs text-slate-700 dark:text-slate-300">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableAutoConvert}
                onChange={(e) => setEnableAutoConvert(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Registrar &ldquo;Convertir a PDF automáticamente&rdquo; (.docx, .jpg, .png)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableCustomCompress}
                onChange={(e) => setEnableCustomCompress(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Registrar &ldquo;Comprimir con ajustes personalizados...&rdquo; (.pdf)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enableMergeSelected}
                onChange={(e) => setEnableMergeSelected(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Registrar &ldquo;Unir archivos seleccionados&rdquo; (MultiSelectModel)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enablePdfToWord}
                onChange={(e) => setEnablePdfToWord(e.target.checked)}
                className="accent-blue-600"
              />
              <span>Registrar &ldquo;Convertir a Word (.docx)&rdquo; (.pdf)</span>
            </label>
          </div>

          <div className="pt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                triggerBlobDownload(
                  new Blob([registryPreview], { type: 'text/plain;charset=utf-8' }),
                  activeScriptTab === 'install'
                    ? 'install_speedpdf_context_menu.reg'
                    : activeScriptTab === 'uninstall'
                    ? 'uninstall_speedpdf_context_menu.reg'
                    : 'speedpdf-shell-handler.ps1'
                )
              }
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar script activo</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800">
              {(
                [
                  { id: 'install', label: 'Instalar (.reg)' },
                  { id: 'uninstall', label: 'Desinstalar (.reg)' },
                  { id: 'ipc', label: 'Despachador IPC (.ps1)' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveScriptTab(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    activeScriptTab === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <FileCode2 className="w-4 h-4 text-slate-400 shrink-0" />
          </div>

          <pre className="p-4 text-xs font-mono text-slate-700 dark:text-slate-300 overflow-x-auto max-h-80 leading-relaxed">
            {registryPreview}
          </pre>
        </div>
      </section>
    </div>
  );
}
