import { Cpu, HardDrive, Layers, ShieldCheck } from 'lucide-react';
import { UpdateCheckerPanel } from './UpdateCheckerPanel';

const COMPATIBILITY_ROWS = [
  {
    os: 'Windows 7 SP1 / 8.1',
    runtime: 'Binario nativo Win32 / Electron 22 LTS o Rust + Slint',
    shell: 'HKCU SystemFileAssociations + MultiSelectModel',
    notes: 'Sin dependencia obligatoria de WebView2 Evergreen',
  },
  {
    os: 'Windows 10 (1809+)',
    runtime: 'Tauri v2 (Rust + WebView2) o .NET 8 WPF',
    shell: 'Menú clásico directo en Explorer + Named Pipes IPC',
    notes: 'Consumo en reposo menor a 45 MB RAM',
  },
  {
    os: 'Windows 11 (21H2–24H2)',
    runtime: 'Tauri v2 + MSIX Sparse Package',
    shell: 'IExplorerCommand moderno + menú clásico compatible',
    notes: 'Aparece en el menú contextual principal sin submenú',
  },
];

const MODULES = [
  {
    title: '01. Motor PDF por flujo y fragmentos',
    file: 'core/pdfEngine.ts',
    detail:
      'Procesa documentos página por página cediendo el hilo principal entre lotes y liberando lienzos de memoria inmediatamente tras cada página para soportar archivos extensos sin bloqueos.',
  },
  {
    title: '02. Puente bidireccional Word y PDF',
    file: 'core/docxBridge.ts',
    detail:
      'Extrae bloques de texto agrupados por coordenadas verticales y jerarquía tipográfica hacia .docx, e interpreta documentos Word en memoria para maquetarlos en PDF.',
  },
  {
    title: '03. Bóveda criptográfica AES-256-GCM',
    file: 'core/cryptoVault.ts',
    detail:
      'Deriva claves mediante PBKDF2-SHA256 (120,000 iteraciones) y cifra localmente con Web Crypto API y vector de inicialización aleatorio por archivo.',
  },
  {
    title: '04. Integración de escritorio e IPC',
    file: 'core/windowsShell.ts',
    detail:
      'Genera entradas de registro HKCU y un despachador Named Pipe para consolidar múltiples archivos seleccionados desde Explorer en una sola instancia ligera.',
  },
];

export function ArchitectureView() {
  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-8">
      <div className="max-w-2xl space-y-1.5">
        <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
          Arquitectura modular, escalable y de bajo consumo
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          Diseño de ingeniería orientado a mantenibilidad, compatibilidad desde Windows 7 hasta Windows 11 y procesamiento local cifrado sin dependencias en la nube.
        </p>
      </div>

      <UpdateCheckerPanel />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 space-y-2">
          <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Privacidad sin red
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Cero peticiones externas al procesar documentos. Todo ocurre en memoria del dispositivo con limpieza opcional de metadatos.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 space-y-2">
          <Cpu className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Bajo uso de RAM
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Liberación explícita de búferes tras cada página y procesamiento secuencial asíncrono para evitar picos de memoria en lotes grandes.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 space-y-2">
          <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Instancia única IPC
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Al abrir múltiples archivos desde el explorador, Named Pipes envía las rutas a un único proceso activo sin duplicar ventanas.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-4 space-y-2">
          <HardDrive className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Motores desacoplados
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Separación estricta entre interfaz React y módulos de dominio para sustituir o actualizar códecs (p. ej. PDFium/MuPDF en Rust) sin reescribir la UI.
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
            Matriz de compatibilidad Windows (7 SP1 a 11)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-900/40">
                <th className="py-2.5 px-5">Versión objetivo</th>
                <th className="py-2.5 px-4">Capa nativa recomendada</th>
                <th className="py-2.5 px-4">Integración Explorer</th>
                <th className="py-2.5 px-5">Consideración clave</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {COMPATIBILITY_ROWS.map((row) => (
                <tr key={row.os} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-5 font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                    {row.os}
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-700 dark:text-slate-300">
                    {row.runtime}
                  </td>
                  <td className="py-3 px-4 text-xs font-mono text-slate-600 dark:text-slate-400">
                    {row.shell}
                  </td>
                  <td className="py-3 px-5 text-xs text-slate-600 dark:text-slate-400">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-display font-semibold text-slate-900 dark:text-slate-100">
          Estructura modular del prototipo actual
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {MODULES.map((mod) => (
            <div
              key={mod.file}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 p-5 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {mod.title}
                </h3>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {mod.file}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {mod.detail}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
