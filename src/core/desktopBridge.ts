export interface DesktopLaunchPayload {
  mode: string;
  format: string;
  sourceDir: string;
  autoConvert: boolean;
  customUi: boolean;
  files: string[];
}

export interface DesktopReadFileResult {
  name: string;
  path: string;
  dir: string;
  size: number;
  lastModified: number;
  data: Uint8Array;
}

export interface DesktopShellStatus {
  supported: boolean;
  integrated: boolean;
  exePath: string;
  isPortable?: boolean;
  isTempExe?: boolean;
  ffmpegPresent?: boolean;
  registeredHealthy?: boolean;
}

export interface DesktopUpdateProgress {
  stage: 'downloading' | 'installing' | 'error';
  percent: number;
  message: string;
}

export interface UnlockPromptFileEntry {
  key: string;
  name: string;
  path?: string;
}

export interface UnlockPromptResult {
  cancelled: boolean;
  mode?: 'shared' | 'per-file';
  sharedPassword?: string;
  passwordsByKey?: Record<string, string>;
}

export interface BackgroundProgressPayload {
  percent: number;
  stage: string;
  detail?: string;
  currentPage?: number;
  totalPages?: number;
  fileCount?: number;
  status?: 'active' | 'done' | 'error';
}

export interface SpeedPdfDesktopApi {
  isDesktop: boolean;
  isPortable: boolean;
  appVersion: string;
  readFiles: (filePaths: string[]) => Promise<DesktopReadFileResult[]>;
  writeFile: (
    targetDir: string,
    fileName: string,
    bytes: Uint8Array
  ) => Promise<string | { fullPath: string; fileName: string }>;
  openExternal: (url: string) => Promise<void>;
  onShellLaunchArgs: (callback: (payload: DesktopLaunchPayload) => void) => () => void;
  signalReady: () => void;
  showMainWindow: () => Promise<void>;
  reportBackgroundProgress: (progress: BackgroundProgressPayload) => void;
  cancelBackgroundTask: () => Promise<void>;
  completeBackgroundTask: (info: { ok: boolean; title: string; body: string }) => Promise<void>;
  getShellStatus: () => Promise<DesktopShellStatus>;
  installShellMenu: () => Promise<DesktopShellStatus>;
  uninstallShellMenu: () => Promise<DesktopShellStatus>;
  installUpdate: (params: {
    downloadUrl: string;
    fileName: string;
    expectedVersion?: string;
  }) => Promise<{ started: boolean; error?: string }>;
  onUpdateProgress: (callback: (progress: DesktopUpdateProgress) => void) => () => void;
  promptUnlockPasswords: (params: {
    files: UnlockPromptFileEntry[];
    errorMessage?: string;
  }) => Promise<UnlockPromptResult>;
  renderHtmlToPdf: (params: {
    html: string;
    pageSize: 'a4' | 'letter';
  }) => Promise<Uint8Array>;
}

declare global {
  interface Window {
    speedPdfDesktop?: SpeedPdfDesktopApi;
  }
}

export function getDesktopBridge(): SpeedPdfDesktopApi | null {
  return typeof window !== 'undefined' && window.speedPdfDesktop?.isDesktop
    ? window.speedPdfDesktop
    : null;
}

const desktopFilePathMap = new WeakMap<File, string>();

export function getDesktopFilePath(file: File): string | undefined {
  return desktopFilePathMap.get(file);
}

export function desktopResultToFile(item: DesktopReadFileResult): File {
  const lower = item.name.toLowerCase();
  const mime = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.docx')
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
    ? 'image/webp'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : 'application/octet-stream';

  const file = new File([new Uint8Array(item.data)], item.name, {
    type: mime,
    lastModified: item.lastModified,
  });
  if (item.path) {
    desktopFilePathMap.set(file, item.path);
  }
  return file;
}
