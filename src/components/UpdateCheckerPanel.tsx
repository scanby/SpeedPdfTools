import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  ExternalLink,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { useState } from 'react';
import {
  CURRENT_APP_VERSION,
  DEFAULT_GITHUB_REPO,
  UpdateCheckResult,
  checkForUpdatesFromRepo,
} from '../core/updater';

interface UpdateCheckerPanelProps {
  compact?: boolean;
}

export function UpdateCheckerPanel({ compact = false }: UpdateCheckerPanelProps) {
  const [repoInput, setRepoInput] = useState(DEFAULT_GITHUB_REPO);
  const [isChecking, setIsChecking] = useState(false);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  const handleCheck = async () => {
    setIsChecking(true);
    const res = await checkForUpdatesFromRepo(repoInput);
    setResult(res);
    setIsChecking(false);
  };

  return (
    <section
      className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 ${
        compact ? 'p-4 space-y-4' : 'p-5 space-y-5'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Buscar actualizaciones manuales
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Conecta bajo demanda con el repositorio GitHub para comparar tu versión local con la última publicada.
          </p>
        </div>

        <div className="text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums shrink-0">
          Versión instalada: v{CURRENT_APP_VERSION}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
        <label className="flex-1 space-y-1.5">
          <span className="block text-xs font-medium text-slate-700 dark:text-slate-300">
            Repositorio GitHub (propietario/repositorio o URL)
          </span>
          <div className="relative">
            <GitBranch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              placeholder="scanby/SpeedPdfTools"
              className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </label>

        <button
          type="button"
          disabled={isChecking}
          onClick={() => {
            void handleCheck();
          }}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin' : ''}`} />
          <span>{isChecking ? 'Verificando repositorio...' : 'Buscar actualizaciones'}</span>
        </button>
      </div>

      {result && (
        <div
          className={`rounded-lg border p-4 space-y-3 ${
            result.status === 'update-available'
              ? 'border-blue-300 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30'
              : result.status === 'up-to-date'
              ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/25'
              : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/25'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              {result.status === 'update-available' ? (
                <ArrowUpCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              ) : result.status === 'up-to-date' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              )}

              <div className="space-y-1">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {result.status === 'update-available'
                    ? 'Actualización disponible'
                    : result.status === 'up-to-date'
                    ? 'Tienes la versión más actualizada'
                    : result.status === 'repo-empty'
                    ? 'Repositorio sin versiones publicadas aún'
                    : 'No se pudo completar la comprobación'}
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {result.message}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums pt-0.5">
                  <span>Actual: v{result.currentVersion}</span>
                  {result.latestVersion && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Repositorio: v{result.latestVersion}</span>
                    </>
                  )}
                  {result.source && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{result.source}</span>
                    </>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>Comprobado a las {result.checkedAt}</span>
                </div>
              </div>
            </div>

            {result.releaseUrl && (
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {result.status === 'update-available' && result.installerUrl && (
                  <a
                    href={result.installerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors whitespace-nowrap shrink-0"
                  >
                    <span>Descargar {result.installerName || 'actualización'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}

                <a
                  href={result.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                >
                  <span>
                    {result.status === 'update-available' ? 'Ver actualización en GitHub' : 'Abrir repositorio'}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          {result.status === 'update-available' && result.releaseNotes && (
            <div className="pt-2 border-t border-blue-200/70 dark:border-blue-800/60">
              <div className="text-xs font-medium text-slate-800 dark:text-slate-200 mb-1">
                Notas de la versión v{result.latestVersion}:
              </div>
              <pre className="text-xs font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap max-h-36 overflow-y-auto">
                {result.releaseNotes}
              </pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
