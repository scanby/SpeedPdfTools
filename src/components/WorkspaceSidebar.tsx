import {
  FileArchive,
  FileImage,
  Files,
  FileText,
  Images,
  Layers,
  Lock,
  Minimize2,
  Moon,
  RefreshCw,
  Sun,
} from 'lucide-react';
import { CURRENT_APP_VERSION } from '../core/updater';
import { PdfToolId } from '../types/speedpdf';

interface WorkspaceSidebarProps {
  activeTool: PdfToolId;
  onSelectTool: (tool: PdfToolId) => void;
  theme: 'dark' | 'light';
  onSetTheme: (theme: 'dark' | 'light') => void;
  onOpenUpdates: () => void;
}

interface ToolNavGroup {
  groupLabel: string;
  items: {
    id: PdfToolId;
    label: string;
    subtitle: string;
    icon: typeof Minimize2;
  }[];
}

const TOOL_GROUPS: ToolNavGroup[] = [
  {
    groupLabel: 'Optimizar y organizar',
    items: [
      {
        id: 'compress',
        label: 'Comprimir PDF',
        subtitle: 'Reducir tamaño local',
        icon: Minimize2,
      },
      {
        id: 'merge',
        label: 'Unir PDFs',
        subtitle: 'Combinar y ordenar',
        icon: Layers,
      },
    ],
  },
  {
    groupLabel: 'Convertir formatos',
    items: [
      {
        id: 'batch-to-pdf',
        label: 'Lote mixto a PDF',
        subtitle: 'Varios formatos a la vez',
        icon: Files,
      },
      {
        id: 'pdf-to-img',
        label: 'PDF a JPG / PNG',
        subtitle: 'Exportar páginas',
        icon: FileImage,
      },
      {
        id: 'img-to-pdf',
        label: 'JPG / PNG a PDF',
        subtitle: 'Imágenes a documento',
        icon: Images,
      },
      {
        id: 'pdf-to-word',
        label: 'PDF a Word (.docx)',
        subtitle: 'Extraer texto editable',
        icon: FileText,
      },
      {
        id: 'word-to-pdf',
        label: 'Word (.docx) a PDF',
        subtitle: 'Maquetación limpia',
        icon: FileArchive,
      },
    ],
  },
  {
    groupLabel: 'Privacidad cifrada',
    items: [
      {
        id: 'vault',
        label: 'Bóveda AES-256',
        subtitle: 'Cifrar y descifrar local',
        icon: Lock,
      },
    ],
  },
];

export function WorkspaceSidebar({
  activeTool,
  onSelectTool,
  theme,
  onSetTheme,
  onOpenUpdates,
}: WorkspaceSidebarProps) {
  return (
    <aside className="w-full lg:w-[264px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4 flex flex-col justify-between gap-6">
      <div className="space-y-6">
        {TOOL_GROUPS.map((group) => (
          <div key={group.groupLabel} className="space-y-1.5">
            <h2 className="px-2.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {group.groupLabel}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTool === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectTool(item.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isActive
                        ? 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-950 dark:text-white shadow-xs'
                        : 'border-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{item.label}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate hidden lg:block">
                        {item.subtitle}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Apariencia</span>
          <div
            role="group"
            aria-label="Selector de tema"
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/80 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
          >
            <button
              type="button"
              onClick={() => onSetTheme('light')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                theme === 'light'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Sun className="w-3.5 h-3.5" />
              <span>Claro</span>
            </button>
            <button
              type="button"
              onClick={() => onSetTheme('dark')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                theme === 'dark'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Moon className="w-3.5 h-3.5" />
              <span>Oscuro</span>
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={onOpenUpdates}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
        >
          <span className="inline-flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
            <span>Buscar actualizaciones</span>
          </span>
          <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
            v{CURRENT_APP_VERSION}
          </span>
        </button>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Procesamiento 100% local en tu dispositivo. Ningún documento sale de tu equipo.
        </p>
      </div>
    </aside>
  );
}
