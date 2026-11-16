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
}

export interface SpeedPdfDesktopApi {
  isDesktop: boolean;
  readFiles: (filePaths: string[]) => Promise<DesktopReadFileResult[]>;
  writeFile: (targetDir: string, fileName: string, bytes: Uint8Array) => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  onShellLaunchArgs: (callback: (payload: DesktopLaunchPayload) => void) => () => void;
  getShellStatus: () => Promise<DesktopShellStatus>;
  installShellMenu: () => Promise<DesktopShellStatus>;
  uninstallShellMenu: () => Promise<DesktopShellStatus>;
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

export function desktopResultToFile(item: DesktopReadFileResult): File {
  const lower = item.name.toLowerCase();
  const mime = lower.endsWith('.pdf')
    ? 'application/pdf'
    : lower.endsWith('.docx')
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
    ? 'image/jpeg'
    : 'application/octet-stream';

  return new File([new Uint8Array(item.data)], item.name, {
    type: mime,
    lastModified: item.lastModified,
  });
}
