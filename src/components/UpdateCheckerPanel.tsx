import {
  AlertCircle,
  ArrowUpCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  GitBranch,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { DesktopUpdateProgress, getDesktopBridge } from '../core/desktopBridge';
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
  const [isInstalling, setIsInstalling] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<DesktopUpdateProgress | null>(null);

  const bridge = getDesktopBridge();

  useEffect(() => {
    if (!bridge) return;
    return bridge.onUpdateProgress((progress) => {
      setUpdateProgress(progress);
      if (progress.stage === 'error') {
        setIsInstalling(false);
      }
    });
  }, [bridge]);

  const handleCheck = async () => {
    setIsChecking(true);
    setUpdateProgress(null);
    const res = await checkForUpdatesFromRepo(repoInput);
    setResult(res);
    setIsChecking(false);
  };

  const handleUnattendedUpdate = async () => {
    if (!bridge || !result?.installerUrl) return;
    setIsInstalling(true);
    setUpdateProgress({
      stage: 'downloading',
      percent: 1,
      message: 'Iniciando descarga de la actualización...',
    });

    const response = await bridge.installUpdate({
      downloadUrl: result.installerUrl,
      fileName: result.installerName || `SPEED.PDF-${result.latestVersion || 'Update'}.exe`,
      expectedVersion: result.latestVersion,
    });

    if (!response.started) {
      setIsInstalling(false);
      setUpdateProgress({
        stage: 'error',
        percent: 0,
        message: response.error || 'No se pudo iniciar la actualización automática.',
      });
    }
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
            Buscar actualizaciones
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {bridge
              ? 'Comprueba nuevas versiones en GitHub y actualiza el programa automáticamente.'
              : 'Compara tu versión local con la última publicada en el repositorio GitHub.'}
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
              disabled={isInstalling}
              placeholder="scanby/SpeedPdfTools"
              className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 disabled:opacity-60"
            />
          </div>
        </label>

        <button
          type="button"
          disabled={isChecking || isInstalling}
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
                {result.status === 'update-available' && result.installerUrl && bridge && (
                  <button
                    type="button"
                    disabled={isInstalling}
                    onClick={() => void handleUnattendedUpdate()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {isInstalling ? 'Actualizando...' : 'Actualizar automáticamente'}
                    </span>
                  </button>
                )}

                {result.status === 'update-available' && result.installerUrl && !bridge && (
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
                    {result.status === 'update-available' ? 'Ver en GitHub' : 'Abrir repositorio'}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}
          </div>

          {updateProgress && (
            <div className="space-y-1.5 pt-2 border-t border-blue-200/70 dark:border-blue-800/60">
              <div className="flex items-center justify-between text-xs">
                <span
                  className={
                    updateProgress.stage === 'error'
                      ? 'text-red-700 dark:text-red-400 font-medium'
                      : 'text-slate-800 dark:text-slate-200 font-medium'
                  }
                >
                  {updateProgress.message}
                </span>
                {updateProgress.stage !== 'error' && (
                  <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
                    {updateProgress.percent}%
                  </span>
                )}
              </div>
              {updateProgress.stage !== 'error' && (
                <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-transform duration-150 origin-left"
                    style={{
                      transform: `scaleX(${Math.max(0.03, updateProgress.percent / 100)})`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

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
