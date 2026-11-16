import { FolderPlus } from 'lucide-react';
import { AppSection } from '../types/speedpdf';

interface TopBarProps {
  activeSection: AppSection;
  onSelectSection: (section: AppSection) => void;
  onTriggerFilePicker: () => void;
}

const NAV_ITEMS: { id: AppSection; label: string }[] = [
  { id: 'workspace', label: 'Estación PDF' },
  { id: 'converter', label: 'Conversor' },
];

export function TopBar({ activeSection, onSelectSection, onTriggerFilePicker }: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-sm">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
        <button
          type="button"
          onClick={() => onSelectSection('workspace')}
          className="text-lg font-display font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md px-1"
        >
          SPEED.PDF
        </button>

        <nav
          aria-label="Navegación principal"
          className="hidden md:flex items-center gap-6 text-sm font-medium"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                className={`py-1.5 transition-colors whitespace-nowrap shrink-0 border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  isActive
                    ? 'border-blue-600 text-slate-950 dark:text-white'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <button
            type="button"
            onClick={onTriggerFilePicker}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
          >
            <FolderPlus className="w-4 h-4 shrink-0" />
            <span>Cargar archivos</span>
          </button>
        </div>
      </div>

      {/* Mobile secondary nav row only on small screens */}
      <nav
        aria-label="Navegación móvil"
        className="flex md:hidden items-center gap-4 px-4 pb-2.5 overflow-x-auto text-xs font-medium border-t border-slate-100 dark:border-slate-900 pt-2"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectSection(item.id)}
              className={`px-2 py-1 rounded whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
