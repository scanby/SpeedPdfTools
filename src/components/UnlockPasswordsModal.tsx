import { AlertCircle, Eye, EyeOff, KeyRound, Lock, X } from 'lucide-react';
import { FormEvent, useState } from 'react';

export interface UnlockModalFileEntry {
  id: string;
  name: string;
}

export interface UnlockModalSubmitPayload {
  mode: 'shared' | 'per-file';
  sharedPassword: string;
  passwordsById: Record<string, string>;
}

interface UnlockPasswordsModalProps {
  files: UnlockModalFileEntry[];
  errorMessage?: string | null;
  onCancel: () => void;
  onSubmit: (payload: UnlockModalSubmitPayload) => void;
}

export function UnlockPasswordsModal({
  files,
  errorMessage,
  onCancel,
  onSubmit,
}: UnlockPasswordsModalProps) {
  const [mode, setMode] = useState<'shared' | 'per-file'>('shared');
  const [sharedPassword, setSharedPassword] = useState('');
  const [passwordsById, setPasswordsById] = useState<Record<string, string>>({});
  const [showShared, setShowShared] = useState(false);
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});

  const isMulti = files.length > 1;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      mode: isMulti ? mode : 'shared',
      sharedPassword,
      passwordsById,
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Contraseña requerida para desproteger PDF"
      className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                Contraseña requerida para desproteger PDF
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {isMulti
                  ? 'Ingresa una misma clave para todos o asigna una contraseña distinta a cada archivo.'
                  : 'Ingresa la contraseña de apertura del documento para generar la copia desprotegida.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancelar desprotección"
            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {errorMessage && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/40 px-3 py-2 flex items-start gap-2 text-xs text-red-800 dark:text-red-200">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
            <span>{errorMessage}</span>
          </div>
        )}

        {isMulti && (
          <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setMode('shared')}
              className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                mode === 'shared'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700/60'
              }`}
            >
              Misma clave para todos
            </button>
            <button
              type="button"
              onClick={() => setMode('per-file')}
              className={`py-1.5 px-3 text-xs font-medium rounded-md transition-colors ${
                mode === 'per-file'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700/60'
              }`}
            >
              Clave por cada archivo
            </button>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-2.5 pr-0.5">
          {!isMulti || mode === 'shared' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-3 py-2 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="truncate font-medium">
                  {files.length === 1
                    ? files[0].name
                    : `${files.length} archivos PDF: ${files.map((f) => f.name).join(', ')}`}
                </span>
              </div>

              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  {isMulti
                    ? `Contraseña común para los ${files.length} archivos`
                    : 'Contraseña de apertura'}
                </span>
                <div className="relative">
                  <input
                    type={showShared ? 'text' : 'password'}
                    value={sharedPassword}
                    onChange={(e) => setSharedPassword(e.target.value)}
                    placeholder="Escribe la contraseña..."
                    autoFocus
                    autoComplete="off"
                    className="w-full pl-3 pr-9 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowShared((prev) => !prev)}
                    aria-label={showShared ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showShared ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </label>
            </div>
          ) : (
            files.map((file, idx) => {
              const isVisible = Boolean(visibleMap[file.id]);
              return (
                <label
                  key={file.id}
                  className="block rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3 space-y-1.5"
                >
                  <span
                    title={file.name}
                    className="block text-xs font-medium text-slate-800 dark:text-slate-200 truncate"
                  >
                    {idx + 1}. {file.name}
                  </span>
                  <div className="relative">
                    <input
                      type={isVisible ? 'text' : 'password'}
                      value={passwordsById[file.id] ?? ''}
                      onChange={(e) =>
                        setPasswordsById((prev) => ({ ...prev, [file.id]: e.target.value }))
                      }
                      placeholder={`Contraseña para ${file.name}`}
                      autoFocus={idx === 0}
                      autoComplete="off"
                      className="w-full pl-3 pr-9 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setVisibleMap((prev) => ({ ...prev, [file.id]: !isVisible }))
                      }
                      aria-label={isVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                    >
                      {isVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </label>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            {isMulti ? `Desproteger ${files.length} PDFs` : 'Desproteger PDF'}
          </button>
        </div>
      </form>
    </div>
  );
}
