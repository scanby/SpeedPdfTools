import { getDesktopBridge } from './desktopBridge';

export const CURRENT_APP_VERSION: string =
  getDesktopBridge()?.appVersion || import.meta.env.VITE_APP_VERSION || '0.1.0';
export const DEFAULT_GITHUB_REPO = 'scanby/SpeedPdfTools';

export type UpdateCheckStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'update-available'
  | 'repo-empty'
  | 'error';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion?: string;
  repo: string;
  source?: 'github-release' | 'github-tag' | 'package-json';
  releaseUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
  installerUrl?: string;
  installerName?: string;
  setupUrl?: string;
  setupName?: string;
  portableUrl?: string;
  portableName?: string;
  checkedAt: string;
  message: string;
}

export function normalizeRepoInput(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/i);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
}

export function parseSemver(versionRaw: string): [number, number, number] | null {
  const cleaned = versionRaw.trim().replace(/^v/i, '');
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareSemver(aRaw: string, bRaw: string): number {
  const a = parseSemver(aRaw);
  const b = parseSemver(bRaw);
  if (!a || !b) {
    return aRaw.localeCompare(bRaw, undefined, { numeric: true });
  }
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function buildComparisonResult(
  repo: string,
  remoteVersion: string,
  source: UpdateCheckResult['source'],
  extras: {
    releaseUrl?: string;
    releaseNotes?: string;
    publishedAt?: string;
    installerUrl?: string;
    installerName?: string;
    setupUrl?: string;
    setupName?: string;
    portableUrl?: string;
    portableName?: string;
  }
): UpdateCheckResult {
  const cleanRemote = remoteVersion.trim().replace(/^v/i, '');
  const cmp = compareSemver(cleanRemote, CURRENT_APP_VERSION);
  const checkedAt = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (cmp > 0) {
    return {
      status: 'update-available',
      currentVersion: CURRENT_APP_VERSION,
      latestVersion: cleanRemote,
      repo,
      source,
      ...extras,
      checkedAt,
      message: `Hay una nueva versión disponible (${cleanRemote}) superior a tu versión instalada (${CURRENT_APP_VERSION}).`,
    };
  }

  return {
    status: 'up-to-date',
    currentVersion: CURRENT_APP_VERSION,
    latestVersion: cleanRemote,
    repo,
    source,
    ...extras,
    checkedAt,
    message: `Tienes la versión más actualizada de SPEED.PDF (${CURRENT_APP_VERSION}).`,
  };
}

export async function checkForUpdatesFromRepo(repoInput: string): Promise<UpdateCheckResult> {
  const repo = normalizeRepoInput(repoInput) || DEFAULT_GITHUB_REPO;
  const checkedAt = new Date().toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return {
      status: 'error',
      currentVersion: CURRENT_APP_VERSION,
      repo,
      checkedAt,
      message: 'Formato de repositorio inválido. Usa propietario/repositorio o URL de GitHub.',
    };
  }

  try {
    // 1. Consultar última Release oficial en GitHub
    const releaseRes = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (releaseRes.ok) {
      const releaseData = (await releaseRes.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
        published_at?: string;
        assets?: { name: string; browser_download_url: string }[];
      };

      if (releaseData.tag_name) {
        const assets = releaseData.assets ?? [];
        const setupAsset = assets.find((a) => /setup.*\.exe$/i.test(a.name));
        const portableAsset = assets.find((a) => /portable.*\.exe$/i.test(a.name));
        const fallbackAsset = assets.find((a) => /\.(exe|msi|zip)$/i.test(a.name));
        const preferred = getDesktopBridge()?.isPortable
          ? portableAsset ?? setupAsset ?? fallbackAsset
          : setupAsset ?? portableAsset ?? fallbackAsset;

        return buildComparisonResult(repo, releaseData.tag_name, 'github-release', {
          releaseUrl: releaseData.html_url,
          releaseNotes: releaseData.body,
          publishedAt: releaseData.published_at,
          installerUrl: preferred?.browser_download_url,
          installerName: preferred?.name,
          setupUrl: setupAsset?.browser_download_url,
          setupName: setupAsset?.name,
          portableUrl: portableAsset?.browser_download_url,
          portableName: portableAsset?.name,
        });
      }
    }

    // 2. Si no hay Releases, consultar tags publicados en el repositorio
    const tagsRes = await fetch(`https://api.github.com/repos/${repo}/tags?per_page=1`, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (tagsRes.ok) {
      const tags = (await tagsRes.json()) as { name?: string }[];
      if (Array.isArray(tags) && tags.length > 0 && tags[0].name) {
        return buildComparisonResult(repo, tags[0].name, 'github-tag', {
          releaseUrl: `https://github.com/${repo}/releases/tag/${tags[0].name}`,
        });
      }
    }

    // 3. Si no hay tags ni releases, consultar package.json en rama main o master
    for (const branch of ['main', 'master']) {
      const pkgRes = await fetch(
        `https://raw.githubusercontent.com/${repo}/${branch}/package.json`,
        { cache: 'no-store' }
      );
      if (pkgRes.ok) {
        const pkg = (await pkgRes.json()) as { version?: string };
        if (pkg.version) {
          return buildComparisonResult(repo, pkg.version, 'package-json', {
            releaseUrl: `https://github.com/${repo}`,
          });
        }
      }
    }

    // 4. Verificar si el repositorio existe pero aún no tiene archivos o releases
    const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });

    if (repoRes.ok) {
      return {
        status: 'repo-empty',
        currentVersion: CURRENT_APP_VERSION,
        repo,
        releaseUrl: `https://github.com/${repo}`,
        checkedAt,
        message:
          'Conexión exitosa con el repositorio, pero aún no hay releases, etiquetas (tags) ni package.json publicados en la rama principal.',
      };
    }

    if (repoRes.status === 404) {
      return {
        status: 'error',
        currentVersion: CURRENT_APP_VERSION,
        repo,
        checkedAt,
        message:
          'No se pudo acceder al repositorio (404). Si el repositorio es privado en GitHub, cámbialo a público para consultar lanzamientos sin token, o verifica el nombre y rama principal.',
      };
    }

    return {
      status: 'error',
      currentVersion: CURRENT_APP_VERSION,
      repo,
      checkedAt,
      message: `GitHub respondió con estado HTTP ${repoRes.status} al consultar actualizaciones.`,
    };
  } catch {
    return {
      status: 'error',
      currentVersion: CURRENT_APP_VERSION,
      repo,
      checkedAt,
      message:
        'No se pudo establecer conexión con GitHub desde este entorno o la red no está disponible.',
    };
  }
}
