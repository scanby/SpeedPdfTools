export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exp);
  return `${value >= 100 || exp === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[exp]}`;
}

export function formatReduction(originalSize: number, outputSize: number): {
  label: string;
  percent: number;
  isSmaller: boolean;
} {
  if (originalSize <= 0) {
    return { label: '0%', percent: 0, isSmaller: false };
  }
  const diff = originalSize - outputSize;
  const percent = (diff / originalSize) * 100;
  if (diff >= 0) {
    return {
      label: `-${percent.toFixed(1)}%`,
      percent,
      isSmaller: true,
    };
  }
  return {
    label: `+${Math.abs(percent).toFixed(1)}%`,
    percent: Math.abs(percent),
    isSmaller: false,
  };
}

export function parsePageRange(rangeInput: string, totalPages: number): number[] {
  const trimmed = rangeInput.trim().toLowerCase();
  if (!trimmed || trimmed === 'todas' || trimmed === 'all' || trimmed === '*') {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const indices = new Set<number>();
  const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      const [startRaw, endRaw] = part.split('-').map((n) => parseInt(n.trim(), 10));
      if (!Number.isNaN(startRaw) && !Number.isNaN(endRaw)) {
        const start = Math.max(1, Math.min(startRaw, totalPages));
        const end = Math.max(1, Math.min(endRaw, totalPages));
        const low = Math.min(start, end);
        const high = Math.max(start, end);
        for (let p = low; p <= high; p++) {
          indices.add(p - 1);
        }
      }
    } else {
      const pageNum = parseInt(part, 10);
      if (!Number.isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
        indices.add(pageNum - 1);
      }
    }
  }

  if (indices.size === 0) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * Normalizes characters not present in WinAnsi (ISO-8859-1 / Windows-1252)
 * so pdf-lib StandardFonts render Spanish and Western European text safely.
 */
export function sanitizeWinAnsiText(input: string): string {
  const replacements: Record<string, string> = {
    '\u2018': "'",
    '\u2019': "'",
    '\u201C': '"',
    '\u201D': '"',
    '\u2013': '-',
    '\u2014': '-',
    '\u2026': '...',
    '\u2022': '-',
    '\u00A0': ' ',
    '\u20AC': 'EUR',
  };

  let out = '';
  for (const ch of input) {
    if (replacements[ch]) {
      out += replacements[ch];
      continue;
    }
    const code = ch.charCodeAt(0);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || code === 10) {
      out += ch;
    } else if (code === 9) {
      out += '  ';
    }
  }
  return out;
}

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}
