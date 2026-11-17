import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { Plugin, defineConfig } from 'vite';

const PDFJS_ASSET_DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'] as const;

const MIME_BY_EXT: Record<string, string> = {
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.icc': 'application/vnd.iccprofile',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
};

function copyDirRecursive(srcDir: string, destDir: string): void {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (!/^LICENSE/i.test(entry.name)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function pdfjsAssetsPlugin(): Plugin {
  const pkgRoot = path.resolve(__dirname, 'node_modules/pdfjs-dist');
  let outDir = path.resolve(__dirname, 'dist');

  return {
    name: 'speedpdf-pdfjs-assets',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0].replace(/^\/+/, '');
        const [subDir, ...rest] = cleanUrl.split('/');
        if (!subDir || !PDFJS_ASSET_DIRS.includes(subDir as (typeof PDFJS_ASSET_DIRS)[number])) {
          next();
          return;
        }
        const subRoot = path.resolve(pkgRoot, subDir);
        const filePath = path.resolve(subRoot, ...rest);
        const rel = path.relative(subRoot, filePath);
        if (rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(filePath)) {
          next();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
        fs.createReadStream(filePath).pipe(res);
      });
    },
    closeBundle() {
      for (const subDir of PDFJS_ASSET_DIRS) {
        copyDirRecursive(path.join(pkgRoot, subDir), path.join(outDir, 'pdfjs', subDir));
      }
    },
  };
}

export default defineConfig(() => {
  return {
    base: process.env.ELECTRON_BUILD === 'true' ? './' : '/',
    build: process.env.ELECTRON_BUILD === 'true' ? { target: 'chrome108' } : undefined,
    worker: {
      format: 'es' as const,
    },
    define: {
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(
        process.env.VITE_APP_VERSION || process.env.npm_package_version || '0.1.0'
      ),
    },
    plugins: [react(), tailwindcss(), pdfjsAssetsPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
