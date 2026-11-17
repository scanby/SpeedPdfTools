import { CheckCircle2, Download, FolderCog, Trash2, X } from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { FileQueuePanel } from './components/FileQueuePanel';
import { OrganizePagesGrid } from './components/OrganizePagesGrid';
import { OutputPanel } from './components/OutputPanel';
import { ToolSettingsPanel } from './components/ToolSettingsPanel';
import { TopBar } from './components/TopBar';
import { UpdateCheckerPanel } from './components/UpdateCheckerPanel';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import {
  convertMixedBatchToSeparatePdfs,
  convertMixedBatchToSinglePdf,
} from './core/batchPdfEngine';
import { decryptVaultLocal, encryptBlobLocal } from './core/cryptoVault';
import {
  DesktopLaunchPayload,
  DesktopShellStatus,
  desktopResultToFile,
  getDesktopBridge,
} from './core/desktopBridge';
import { docxToPdf, pdfToDocx } from './core/docxBridge';
import {
  formatBytes,
  stripExtension,
  triggerBlobDownload,
} from './core/formatters';
import {
  assembleOrganizedPdf,
  compressPdf,
  getPdfPageCount,
  imagesToPdf,
  inspectImageFile,
  inspectPdfFile,
  mergePdfs,
  pdfToImages,
  renderPdfAllPageThumbnails,
  rotatePdf,
} from './core/pdfEngine';
import {
  createSampleDocxFile,
  createSampleImageFile,
  createSamplePdfFile,
} from './core/sampleFactory';
import {
  generateInstallRegistryScript,
  generateUninstallRegistryScript,
} from './core/windowsShell';
import {
  AppSection,
  BatchConvertMode,
  CompressionSettings,
  ImageExportSettings,
  ImageToPdfSettings,
  OrganizerPageItem,
  OrganizerSourceFile,
  PdfToolId,
  ProcessedOutput,
  ProgressState,
  QueueFileItem,
  RotationAngle,
  WordConversionSettings,
} from './types/speedpdf';

const TOOL_METADATA: Record<
  PdfToolId,
  { title: string; description: string; acceptedHint: string; acceptAttr: string }
> = {
  compress: {
    title: 'Comprimir PDF localmente',
    description:
      'Reduce el peso de documentos extensos mediante optimización estructural o muestreo DPI configurable sin subir archivos.',
    acceptedHint: 'Archivos PDF (.pdf)',
    acceptAttr: '.pdf,application/pdf',
  },
  merge: {
    title: 'Unir múltiples PDFs',
    description:
      'Combina documentos en un único PDF, arrastra las tarjetas para definir su orden y gira páginas si lo necesitas.',
    acceptedHint: '2 o más archivos PDF (.pdf)',
    acceptAttr: '.pdf,application/pdf',
  },
  organize: {
    title: 'Ordenar y mezclar páginas PDF',
    description:
      'Agrupa las páginas de cada PDF por color en cuadrícula, enumera cada página por archivo, gira 90°, elimina o mezcla páginas libremente.',
    acceptedHint: 'Uno o más archivos PDF (.pdf)',
    acceptAttr: '.pdf,application/pdf',
  },
  rotate: {
    title: 'Girar PDF 90° localmente',
    description:
      'Corrige la orientación de archivos cuyo contenido quedó girado o invertido respecto al documento (90°, 180° o 270°) sin perder calidad.',
    acceptedHint: 'Archivos PDF (.pdf)',
    acceptAttr: '.pdf,application/pdf',
  },
  'batch-to-pdf': {
    title: 'Lote mixto a PDF',
    description:
      'Convierte varios archivos de distinto formato (.pdf, .docx, .jpg, .png) juntos en un solo PDF o en un PDF por separado para cada archivo.',
    acceptedHint: 'PDF, Word (.docx), JPG o PNG combinados',
    acceptAttr: '.pdf,.docx,.jpg,.jpeg,.png',
  },
  'pdf-to-img': {
    title: 'Convertir PDF a JPG o PNG',
    description:
      'Renderiza cada página de tu PDF a imágenes de alta nitidez en tu dispositivo, individuales o en paquete ZIP.',
    acceptedHint: 'Archivos PDF (.pdf)',
    acceptAttr: '.pdf,application/pdf',
  },
  'img-to-pdf': {
    title: 'Convertir imágenes JPG / PNG a PDF',
    description:
      'Agrupa fotografías, capturas o escaneos en un documento PDF limpio con tamaño y orientación configurables.',
    acceptedHint: 'Imágenes JPG, JPEG o PNG',
    acceptAttr: '.jpg,.jpeg,.png,image/jpeg,image/png',
  },
  'pdf-to-word': {
    title: 'Convertir PDF a Word (.docx)',
    description:
      'Extrae párrafos, títulos y saltos de página desde PDFs locales hacia documentos Word editables.',
    acceptedHint: 'Archivos PDF (.pdf)',
    acceptAttr: '.pdf,application/pdf',
  },
  'word-to-pdf': {
    title: 'Convertir Word (.docx) a PDF',
    description:
      'Transforma documentos .docx en archivos PDF portables con paginación automática y tipografía nítida.',
    acceptedHint: 'Documentos Word (.docx)',
    acceptAttr: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  vault: {
    title: 'Bóveda cifrada local AES-256-GCM',
    description:
      'Protege o descifra documentos sensibles directamente en tu equipo mediante derivación PBKDF2-SHA256.',
    acceptedHint: 'Cualquier PDF, DOCX, imagen o paquete .speedvault',
    acceptAttr: '.pdf,.docx,.jpg,.jpeg,.png,.speedvault',
  },
};

function detectFileKind(file: File): QueueFileItem['kind'] {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.speedvault')) return 'vault';
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (lower.endsWith('.docx')) return 'docx';
  return 'image';
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('speedpdf_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [activeSection, setActiveSection] = useState<AppSection>('workspace');
  const [activeTool, setActiveTool] = useState<PdfToolId>('compress');
  const [queue, setQueue] = useState<QueueFileItem[]>([]);
  const [outputs, setOutputs] = useState<ProcessedOutput[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [contextBanner, setContextBanner] = useState<string | null>(null);

  const [progress, setProgress] = useState<ProgressState>({
    active: false,
    percent: 0,
    stage: '',
  });

  // Tool settings state
  const [compression, setCompression] = useState<CompressionSettings>({
    preset: 'balanced',
    dpi: 144,
    jpegQuality: 0.75,
    stripMetadata: true,
    structuralOnly: false,
  });

  const [mergeOutputName, setMergeOutputName] = useState('documento_unificado');
  const [mergeStripMetadata, setMergeStripMetadata] = useState(true);
  const [organizeOutputName, setOrganizeOutputName] = useState('documento_ordenado');
  const [organizeStripMetadata, setOrganizeStripMetadata] = useState(true);
  const [organizerFiles, setOrganizerFiles] = useState<OrganizerSourceFile[]>([]);
  const [organizerPages, setOrganizerPages] = useState<OrganizerPageItem[]>([]);
  const [organizerLoadingCount, setOrganizerLoadingCount] = useState(0);
  const [rotateStripMetadata, setRotateStripMetadata] = useState(true);

  const [imageExport, setImageExport] = useState<ImageExportSettings>({
    format: 'jpeg',
    dpi: 150,
    quality: 0.88,
    bundleAsZip: true,
  });

  const [imageToPdf, setImageToPdf] = useState<ImageToPdfSettings>({
    pageSize: 'a4',
    orientation: 'auto',
    marginPt: 18,
    jpegQuality: 0.9,
  });

  const [wordSettings, setWordSettings] = useState<WordConversionSettings>({
    preservePageBreaks: true,
    fontSize: 11,
    pageSize: 'a4',
  });

  const [vaultMode, setVaultMode] = useState<'encrypt' | 'decrypt'>('encrypt');
  const [batchConvertMode, setBatchConvertMode] = useState<BatchConvertMode>('single-pdf');
  const [batchOutputName, setBatchOutputName] = useState('lote_convertido_unificado');
  const [encryptOutput, setEncryptOutput] = useState(false);
  const [vaultPassword, setVaultPassword] = useState('');
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);
  const [isShellModalOpen, setIsShellModalOpen] = useState(false);
  const [shellStatus, setShellStatus] = useState<DesktopShellStatus | null>(null);
  const [shellBusy, setShellBusy] = useState(false);
  const [shellFeedback, setShellFeedback] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const organizerSessionRef = useRef(0);
  const organizerColorCounterRef = useRef(0);
  const organizerThumbCacheRef = useRef<Map<string, Record<number, string>>>(new Map());

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('speedpdf_theme', theme);
  }, [theme]);

  // Cleanup generated thumbnail object URLs on unmount
  const queueRef = useRef(queue);
  queueRef.current = queue;
  useEffect(() => {
    return () => {
      queueRef.current.forEach((item) => {
        if (item.thumbnailUrl && item.thumbnailUrl.startsWith('blob:')) {
          URL.revokeObjectURL(item.thumbnailUrl);
        }
      });
    };
  }, []);

  const addPdfFilesToOrganizer = async (fileList: FileList | File[], replace = false) => {
    setErrorMessage(null);
    const incoming = Array.from(fileList);
    const pdfFiles = incoming.filter((f) => detectFileKind(f) === 'pdf');
    if (pdfFiles.length === 0) {
      if (incoming.length > 0) {
        setErrorMessage('Solo se admiten archivos PDF (.pdf) en el módulo Ordenar PDF.');
      }
      return;
    }
    if (pdfFiles.length < incoming.length) {
      setErrorMessage('Algunos archivos no eran PDF y fueron omitidos en el organizador.');
    }

    if (replace) {
      organizerSessionRef.current += 1;
      organizerColorCounterRef.current = 0;
      organizerThumbCacheRef.current.clear();
      setOrganizerFiles([]);
      setOrganizerPages([]);
      setOutputs([]);
    }

    const sessionId = organizerSessionRef.current;

    for (const file of pdfFiles) {
      if (sessionId !== organizerSessionRef.current) return;
      try {
        const pageCount = await getPdfPageCount(file);
        if (sessionId !== organizerSessionRef.current) return;
        if (pageCount <= 0) continue;

        const sourceFileId = crypto.randomUUID();
        const colorIndex = organizerColorCounterRef.current++;

        const newSourceFile: OrganizerSourceFile = {
          id: sourceFileId,
          file,
          name: file.name,
          size: file.size,
          pageCount,
          colorIndex,
        };

        const newPages: OrganizerPageItem[] = Array.from({ length: pageCount }, (_, i) => ({
          id: crypto.randomUUID(),
          sourceFileId,
          sourceFileName: file.name,
          colorIndex,
          originalPageNumber: i + 1,
          rotation: 0,
        }));

        setOrganizerFiles((prev) => [...prev, newSourceFile]);
        setOrganizerPages((prev) => [...prev, ...newPages]);

        setOrganizerLoadingCount((c) => c + 1);
        void renderPdfAllPageThumbnails(
          file,
          (pageNum, thumbnailUrl) => {
            if (sessionId !== organizerSessionRef.current) return;
            const cache = organizerThumbCacheRef.current.get(sourceFileId) ?? {};
            cache[pageNum] = thumbnailUrl;
            organizerThumbCacheRef.current.set(sourceFileId, cache);

            setOrganizerPages((prev) =>
              prev.map((p) =>
                p.sourceFileId === sourceFileId && p.originalPageNumber === pageNum
                  ? { ...p, thumbnailUrl }
                  : p
              )
            );
          },
          () => sessionId !== organizerSessionRef.current
        )
          .catch(() => {
            // Keep page cards functional even if a thumbnail fails to render
          })
          .finally(() => {
            setOrganizerLoadingCount((c) => Math.max(0, c - 1));
          });
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? `No se pudo abrir ${file.name}: ${err.message}`
            : `No se pudo leer el archivo PDF ${file.name}.`
        );
      }
    }
  };

  const handleSelectSection = (section: AppSection) => {
    setActiveSection(section);
    if (
      section === 'workspace' &&
      !['compress', 'merge', 'organize', 'rotate', 'vault'].includes(activeTool)
    ) {
      setActiveTool('compress');
    } else if (
      section === 'converter' &&
      !['batch-to-pdf', 'pdf-to-img', 'img-to-pdf', 'pdf-to-word', 'word-to-pdf'].includes(
        activeTool
      )
    ) {
      setActiveTool('pdf-to-word');
    }
  };

  const handleSelectTool = (tool: PdfToolId) => {
    setActiveTool(tool);
    setErrorMessage(null);
    setContextBanner(null);
    setOutputs([]);
    if (['compress', 'merge', 'organize', 'rotate', 'vault'].includes(tool)) {
      setActiveSection('workspace');
    } else {
      setActiveSection('converter');
    }
    if (tool === 'organize' && organizerFiles.length === 0) {
      const queuedPdfs = queue.filter((q) => q.kind === 'pdf').map((q) => q.file);
      if (queuedPdfs.length > 0) {
        void addPdfFilesToOrganizer(queuedPdfs, true);
      }
    }
  };

  const addFilesToQueue = async (
    fileList: FileList | File[],
    replace = false,
    skipPreview = false
  ): Promise<QueueFileItem[]> => {
    setErrorMessage(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return [];

    const newItems: QueueFileItem[] = incoming.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      kind: detectFileKind(file),
      pageRange: 'Todas',
      rotation: 0,
      addedAt: Date.now(),
    }));

    setQueue((prev) => (replace ? newItems : [...prev, ...newItems]));

    if (skipPreview) {
      return newItems;
    }

    // Inspect PDFs and images asynchronously without blocking UI
    for (const item of newItems) {
      try {
        if (item.kind === 'pdf') {
          const info = await inspectPdfFile(item.file);
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, pageCount: info.pageCount, thumbnailUrl: info.thumbnailUrl }
                : q
            )
          );
        } else if (item.kind === 'image') {
          const info = await inspectImageFile(item.file);
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, thumbnailUrl: info.thumbnailUrl } : q))
          );
        }
      } catch {
        // Keep item in queue even if preview generation fails
      }
    }

    return newItems;
  };

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      if (activeTool === 'organize') {
        void addPdfFilesToOrganizer(e.target.files);
      } else {
        void addFilesToQueue(e.target.files);
      }
      e.target.value = '';
    }
  };

  const handleRemoveItem = (id: string) => {
    setQueue((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.thumbnailUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(target.thumbnailUrl);
      }
      return prev.filter((i) => i.id !== id);
    });
  };

  const handleReorderItem = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setQueue((prev) => {
      const fromIdx = prev.findIndex((i) => i.id === fromId);
      const toIdx = prev.findIndex((i) => i.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const handleRotateItem = (id: string, deltaDegrees = 90) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const next = ((((item.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360;
        return { ...item, rotation: next as RotationAngle };
      })
    );
  };

  const handleRotateAll = (deltaDegrees: number) => {
    setQueue((prev) =>
      prev.map((item) => {
        if (item.kind !== 'pdf' && item.kind !== 'image') return item;
        const next = ((((item.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360;
        return { ...item, rotation: next as RotationAngle };
      })
    );
  };

  const handleResetRotations = () => {
    setQueue((prev) => prev.map((item) => ({ ...item, rotation: 0 })));
  };

  const handleUpdatePageRange = (id: string, pageRange: string) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, pageRange } : item)));
  };

  const handleReorderOrganizerPage = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setOrganizerPages((prev) => {
      const fromIdx = prev.findIndex((p) => p.id === fromId);
      const toIdx = prev.findIndex((p) => p.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const handleMoveOrganizerPageStep = (id: string, delta: -1 | 1) => {
    setOrganizerPages((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      const targetIdx = idx + delta;
      if (idx < 0 || targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(targetIdx, 0, moved);
      return copy;
    });
  };

  const handleRotateOrganizerPage = (id: string, deltaDegrees = 90) => {
    setOrganizerPages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const next = ((((p.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360;
        return { ...p, rotation: next as RotationAngle };
      })
    );
  };

  const handleRotateOrganizerFilePages = (sourceFileId: string, deltaDegrees = 90) => {
    setOrganizerPages((prev) =>
      prev.map((p) => {
        if (p.sourceFileId !== sourceFileId) return p;
        const next = ((((p.rotation ?? 0) + deltaDegrees) % 360) + 360) % 360;
        return { ...p, rotation: next as RotationAngle };
      })
    );
  };

  const handleRemoveOrganizerPage = (id: string) => {
    setOrganizerPages((prev) => prev.filter((p) => p.id !== id));
  };

  const handleRemoveOrganizerFile = (sourceFileId: string) => {
    organizerThumbCacheRef.current.delete(sourceFileId);
    setOrganizerPages((prev) => prev.filter((p) => p.sourceFileId !== sourceFileId));
    setOrganizerFiles((prev) => {
      const next = prev.filter((sf) => sf.id !== sourceFileId);
      if (next.length === 0) {
        organizerColorCounterRef.current = 0;
      }
      return next;
    });
  };

  const handleGroupOrganizerByFile = () => {
    const fileOrder = new Map<string, number>();
    organizerFiles.forEach((sf, i) => fileOrder.set(sf.id, i));
    setOrganizerPages((prev) =>
      [...prev].sort((a, b) => {
        const orderA = fileOrder.get(a.sourceFileId) ?? 9999;
        const orderB = fileOrder.get(b.sourceFileId) ?? 9999;
        if (orderA !== orderB) return orderA - orderB;
        return a.originalPageNumber - b.originalPageNumber;
      })
    );
  };

  const handleResetOrganizerPages = () => {
    const rebuilt: OrganizerPageItem[] = [];
    for (const sf of organizerFiles) {
      const cache = organizerThumbCacheRef.current.get(sf.id) ?? {};
      for (let pageNum = 1; pageNum <= sf.pageCount; pageNum++) {
        rebuilt.push({
          id: crypto.randomUUID(),
          sourceFileId: sf.id,
          sourceFileName: sf.name,
          colorIndex: sf.colorIndex,
          originalPageNumber: pageNum,
          rotation: 0,
          thumbnailUrl: cache[pageNum],
        });
      }
    }
    setOrganizerPages(rebuilt);
    setOutputs([]);
  };

  const handleClearOrganizer = () => {
    organizerSessionRef.current += 1;
    organizerColorCounterRef.current = 0;
    organizerThumbCacheRef.current.clear();
    setOrganizerFiles([]);
    setOrganizerPages([]);
    setOrganizerLoadingCount(0);
    setOutputs([]);
    setErrorMessage(null);
  };

  const handleLoadSample = async () => {
    setErrorMessage(null);
    if (activeTool === 'organize') {
      const f1 = await createSamplePdfFile('Documento_Amarillo.pdf', 3);
      const f2 = await createSamplePdfFile('Anexo_Azul_Pastel.pdf', 3);
      await addPdfFilesToOrganizer([f1, f2], true);
    } else if (activeTool === 'merge') {
      const f1 = await createSamplePdfFile('Contrato_Principal.pdf', 2);
      const f2 = await createSamplePdfFile('Anexo_Tecnico.pdf', 2);
      await addFilesToQueue([f1, f2], true);
    } else if (activeTool === 'batch-to-pdf') {
      const f1 = await createSamplePdfFile('Informe_Corporativo_2026.pdf', 2);
      const f2 = await createSampleDocxFile('Propuesta_Comercial.docx');
      const f3 = await createSampleImageFile('Portada_AltaRes.jpg');
      await addFilesToQueue([f1, f2, f3], true);
    } else if (activeTool === 'img-to-pdf') {
      const img1 = await createSampleImageFile('Portada_AltaRes.jpg');
      const img2 = await createSampleImageFile('Anexo_Visual.jpg');
      await addFilesToQueue([img1, img2], true);
    } else if (activeTool === 'word-to-pdf') {
      const doc = await createSampleDocxFile('Propuesta_Comercial.docx');
      await addFilesToQueue([doc], true);
    } else {
      const pdf = await createSamplePdfFile('Informe_Corporativo_2026.pdf', 3);
      await addFilesToQueue([pdf], true);
    }
  };

  const executeToolWithItems = async (
    toolToRun: PdfToolId,
    itemsToProcess: QueueFileItem[],
    batchModeOverride?: BatchConvertMode,
    imageFormatOverride?: ImageExportSettings['format'],
    onProgressUpdate?: (state: ProgressState) => void,
    onToolError?: (message: string) => void
  ): Promise<ProcessedOutput[]> => {
    if (toolToRun !== 'organize' && itemsToProcess.length === 0) return [];
    setErrorMessage(null);

    const reportProgress = (state: ProgressState) => {
      setProgress(state);
      onProgressUpdate?.(state);
    };

    try {
      const started = performance.now();
      const createdOutputs: ProcessedOutput[] = [];

      const maybeEncrypt = async (
        blob: Blob,
        fileName: string,
        originalSize: number,
        summary: string,
        pageCount?: number
      ): Promise<ProcessedOutput> => {
        const shouldEncrypt = encryptOutput && toolToRun !== 'vault';
        const finalBlob = shouldEncrypt
          ? await encryptBlobLocal(blob, vaultPassword, fileName)
          : blob;
        const finalName = shouldEncrypt ? `${fileName}.speedvault` : fileName;

        return {
          id: crypto.randomUUID(),
          tool: toolToRun,
          fileName: finalName,
          mimeType: shouldEncrypt ? 'application/octet-stream' : blob.type,
          blob: finalBlob,
          originalSize,
          outputSize: finalBlob.size,
          durationMs: Math.round(performance.now() - started),
          pageCount,
          encrypted: shouldEncrypt,
          summary: shouldEncrypt ? `${summary} · Cifrado AES-256` : summary,
          createdAt: Date.now(),
        };
      };

      if (toolToRun === 'compress') {
        const pdfItems = itemsToProcess.filter((i) => i.kind === 'pdf');
        if (pdfItems.length === 0) {
          throw new Error('Carga al menos un archivo PDF para comprimir.');
        }
        for (const item of pdfItems) {
          const res = await compressPdf(
            item.file,
            compression,
            reportProgress,
            item.rotation ?? 0
          );
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            item.size,
            compression.structuralOnly
              ? `Optimización estructural (${res.pageCount} pág.)`
              : `Compresión ${compression.dpi} DPI (${res.pageCount} pág.)`,
            res.pageCount
          );
          createdOutputs.push(out);
        }
      } else if (toolToRun === 'merge') {
        const pdfItems = itemsToProcess.filter((i) => i.kind === 'pdf');
        if (pdfItems.length < 2) {
          throw new Error('Se necesitan al menos 2 archivos PDF para unir.');
        }
        const totalInSize = pdfItems.reduce((acc, i) => acc + i.size, 0);
        const res = await mergePdfs(pdfItems, mergeStripMetadata, mergeOutputName, reportProgress);
        const out = await maybeEncrypt(
          res.blob,
          res.fileName,
          totalInSize,
          `Unión de ${pdfItems.length} archivos (${res.pageCount} pág.)`,
          res.pageCount
        );
        createdOutputs.push(out);
      } else if (toolToRun === 'organize') {
        if (organizerPages.length === 0) {
          throw new Error('Carga al menos un archivo PDF y conserva 1 página para exportar.');
        }
        const usedIds = new Set(organizerPages.map((p) => p.sourceFileId));
        const usedFiles = organizerFiles.filter((sf) => usedIds.has(sf.id));
        const totalInSize = usedFiles.reduce((acc, sf) => acc + sf.size, 0);
        const res = await assembleOrganizedPdf(
          organizerFiles,
          organizerPages,
          organizeOutputName,
          organizeStripMetadata,
          reportProgress
        );
        const out = await maybeEncrypt(
          res.blob,
          res.fileName,
          totalInSize,
          `PDF ordenado desde ${usedFiles.length} ${usedFiles.length === 1 ? 'archivo' : 'archivos'} (${res.pageCount} pág.)`,
          res.pageCount
        );
        createdOutputs.push(out);
      } else if (toolToRun === 'rotate') {
        const pdfItems = itemsToProcess.filter((i) => i.kind === 'pdf');
        if (pdfItems.length === 0) {
          throw new Error('Carga al menos un archivo PDF para girar.');
        }
        for (const item of pdfItems) {
          const targetDegrees = item.rotation || 90;
          const res = await rotatePdf(
            item.file,
            targetDegrees,
            item.pageRange,
            rotateStripMetadata,
            reportProgress
          );
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            item.size,
            `Rotación +${res.appliedDegrees}° (${res.pageCount} pág.)`,
            res.pageCount
          );
          createdOutputs.push(out);
        }
      } else if (toolToRun === 'batch-to-pdf') {
        const effectiveMode = batchModeOverride ?? batchConvertMode;
        const convertible = itemsToProcess.filter((i) => i.kind !== 'vault');
        if (convertible.length === 0) {
          throw new Error('Carga al menos un archivo PDF, Word (.docx) o imagen (JPG/PNG).');
        }
        if (effectiveMode === 'single-pdf') {
          const totalInSize = convertible.reduce((acc, i) => acc + i.size, 0);
          const res = await convertMixedBatchToSinglePdf(
            convertible,
            batchOutputName,
            imageToPdf,
            wordSettings,
            reportProgress
          );
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            totalInSize,
            `Lote mixto unificado (${convertible.length} archivos · ${res.pageCount} pág.)`,
            res.pageCount
          );
          createdOutputs.push(out);
        } else {
          const results = await convertMixedBatchToSeparatePdfs(
            convertible,
            imageToPdf,
            wordSettings,
            reportProgress
          );
          for (const res of results) {
            const out = await maybeEncrypt(
              res.blob,
              res.fileName,
              res.originalSize,
              `PDF individual (${res.sourceKind.toUpperCase()} · ${res.pageCount} pág.)`,
              res.pageCount
            );
            createdOutputs.push(out);
          }
        }
      } else if (toolToRun === 'pdf-to-img') {
        const pdfItems = itemsToProcess.filter((i) => i.kind === 'pdf');
        if (pdfItems.length === 0) {
          throw new Error('Carga un archivo PDF para exportar a JPG/PNG.');
        }
        const effectiveImgConfig: ImageExportSettings = imageFormatOverride
          ? { ...imageExport, format: imageFormatOverride }
          : imageExport;
        for (const item of pdfItems) {
          const res = await pdfToImages(
            item.file,
            effectiveImgConfig,
            reportProgress,
            item.rotation ?? 0
          );
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            item.size,
            `Exportado a ${effectiveImgConfig.format.toUpperCase()} · ${effectiveImgConfig.dpi} DPI (${res.pageCount} pág.)`,
            res.pageCount
          );
          createdOutputs.push(out);
        }
      } else if (toolToRun === 'img-to-pdf') {
        const imgItems = itemsToProcess.filter((i) => i.kind === 'image');
        if (imgItems.length === 0) {
          throw new Error('Carga imágenes JPG o PNG para convertir a PDF.');
        }
        const totalInSize = imgItems.reduce((acc, i) => acc + i.size, 0);
        const res = await imagesToPdf(
          imgItems.map((i) => i.file),
          imageToPdf,
          reportProgress,
          imgItems.map((i) => i.rotation ?? 0)
        );
        const out = await maybeEncrypt(
          res.blob,
          res.fileName,
          totalInSize,
          `PDF generado desde ${imgItems.length} ${imgItems.length === 1 ? 'imagen' : 'imágenes'}`,
          res.pageCount
        );
        createdOutputs.push(out);
      } else if (toolToRun === 'pdf-to-word') {
        const pdfItems = itemsToProcess.filter((i) => i.kind === 'pdf');
        if (pdfItems.length === 0) {
          throw new Error('Carga un archivo PDF para convertir a Word (.docx).');
        }
        for (const item of pdfItems) {
          const res = await pdfToDocx(item.file, wordSettings, reportProgress);
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            item.size,
            `Convertido a Word (.docx · ${res.pageCount} pág.)`,
            res.pageCount
          );
          createdOutputs.push(out);
        }
      } else if (toolToRun === 'word-to-pdf') {
        const docItems = itemsToProcess.filter((i) => i.kind === 'docx');
        if (docItems.length === 0) {
          throw new Error('Carga un documento Word (.docx) para convertir a PDF.');
        }
        for (const item of docItems) {
          const res = await docxToPdf(item.file, wordSettings, reportProgress);
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            item.size,
            `Convertido a PDF (${res.pageCount} pág.)`,
            res.pageCount
          );
          createdOutputs.push(out);
        }
      } else if (toolToRun === 'vault') {
        for (const item of itemsToProcess) {
          reportProgress({
            active: true,
            percent: 40,
            stage:
              vaultMode === 'encrypt'
                ? `Cifrando ${item.name} con AES-256-GCM...`
                : `Descifrando ${item.name}...`,
          });

          if (vaultMode === 'encrypt') {
            const encryptedBlob = await encryptBlobLocal(item.file, vaultPassword, item.name);
            createdOutputs.push({
              id: crypto.randomUUID(),
              tool: 'vault',
              fileName: `${item.name}.speedvault`,
              mimeType: 'application/octet-stream',
              blob: encryptedBlob,
              originalSize: item.size,
              outputSize: encryptedBlob.size,
              durationMs: Math.round(performance.now() - started),
              encrypted: true,
              summary: 'Cifrado local AES-256-GCM',
              createdAt: Date.now(),
            });
          } else {
            const decrypted = await decryptVaultLocal(item.file, vaultPassword);
            createdOutputs.push({
              id: crypto.randomUUID(),
              tool: 'vault',
              fileName: decrypted.metadata.originalName || `${stripExtension(item.name)}`,
              mimeType: decrypted.metadata.mimeType,
              blob: decrypted.blob,
              originalSize: item.size,
              outputSize: decrypted.blob.size,
              durationMs: Math.round(performance.now() - started),
              encrypted: false,
              summary: 'Archivo descifrado localmente',
              createdAt: Date.now(),
            });
          }
        }
        reportProgress({ active: false, percent: 100, stage: 'Completado' });
      }

      setOutputs(createdOutputs);
      return createdOutputs;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ocurrió un error al procesar el archivo.';
      setProgress({ active: false, percent: 0, stage: '' });
      setErrorMessage(msg);
      onToolError?.(msg);
      return [];
    }
  };

  const desktopHandlerRef = useRef<(payload: DesktopLaunchPayload) => Promise<void>>(async () => {});
  desktopHandlerRef.current = async (payload: DesktopLaunchPayload) => {
    const bridge = getDesktopBridge();
    if (!bridge || payload.files.length === 0) return;

    try {
      const rawItems = await bridge.readFiles(payload.files);
      const files = rawItems.map(desktopResultToFile);
      if (files.length === 0) {
        await bridge.completeBackgroundTask({
          ok: false,
          title: 'SPEED.PDF',
          body: 'No se encontraron archivos compatibles para procesar.',
        });
        return;
      }

      let targetTool: PdfToolId = 'compress';
      let autoRun = payload.autoConvert && !payload.customUi;
      let batchOverride: BatchConvertMode | undefined;
      let imgFormatOverride: ImageExportSettings['format'] | undefined;

      if (payload.mode === 'batch-single-pdf') {
        targetTool = 'batch-to-pdf';
        batchOverride = 'single-pdf';
        setBatchConvertMode('single-pdf');
        autoRun = !payload.customUi;
      } else if (payload.mode === 'batch-separate-pdfs') {
        targetTool = 'batch-to-pdf';
        batchOverride = 'separate-pdfs';
        setBatchConvertMode('separate-pdfs');
        autoRun = !payload.customUi;
      } else if (payload.mode === 'merge') {
        targetTool = 'merge';
        autoRun = !payload.customUi && files.length >= 2;
      } else if (payload.mode === 'word-to-pdf') {
        targetTool = 'word-to-pdf';
        autoRun = payload.autoConvert && !payload.customUi;
      } else if (payload.mode === 'img-to-pdf') {
        targetTool = 'img-to-pdf';
        autoRun = payload.autoConvert && !payload.customUi;
      } else if (payload.mode === 'compress' && payload.autoConvert) {
        targetTool = 'compress';
        autoRun = true;
      } else if (payload.autoConvert && payload.format === 'docx') {
        targetTool = 'pdf-to-word';
        autoRun = true;
      } else if (payload.autoConvert && (payload.format === 'jpg' || payload.format === 'png')) {
        targetTool = 'pdf-to-img';
        imgFormatOverride = payload.format === 'png' ? 'png' : 'jpeg';
        setImageExport((prev) => ({ ...prev, format: imgFormatOverride ?? prev.format }));
        autoRun = true;
      } else if (payload.autoConvert && payload.format === 'pdf') {
        const hasMixed = files.length > 1 && new Set(files.map(detectFileKind)).size > 1;
        const firstKind = detectFileKind(files[0]);
        targetTool = hasMixed
          ? 'batch-to-pdf'
          : firstKind === 'docx'
          ? 'word-to-pdf'
          : 'img-to-pdf';
        autoRun = true;
      } else {
        targetTool = 'compress';
        autoRun = false;
      }

      handleSelectTool(targetTool);
      const items = await addFilesToQueue(files, true, autoRun);

      if (!autoRun) {
        await bridge.showMainWindow();
        setContextBanner(
          payload.mode === 'merge' && files.length < 2
            ? `Selecciona al menos 2 PDFs para unir o agrega otro documento aquí (${payload.sourceDir}).`
            : `Archivo(s) cargados desde el Explorador de Windows (${payload.sourceDir}) listos para ajustar.`
        );
        return;
      }

      const sendBgProgress = (state: ProgressState) => {
        bridge.reportBackgroundProgress({
          percent: state.percent,
          stage: state.stage,
          currentPage: state.currentPage,
          totalPages: state.totalPages,
          fileCount: files.length,
          detail: `Destino: ${payload.sourceDir}`,
          status: 'active',
        });
      };

      sendBgProgress({
        active: true,
        percent: 12,
        stage: `Procesando ${files.length} archivo(s)...`,
      });

      let capturedError: string | null = null;

      const created = await executeToolWithItems(
        targetTool,
        items,
        batchOverride,
        imgFormatOverride,
        sendBgProgress,
        (msg) => {
          capturedError = msg;
        }
      );

      if (created.length > 0) {
        sendBgProgress({
          active: true,
          percent: 97,
          stage: `Guardando ${created.length} archivo(s) en la carpeta original...`,
        });
        const savedNames: string[] = [];
        for (const out of created) {
          const bytes = new Uint8Array(await out.blob.arrayBuffer());
          await bridge.writeFile(payload.sourceDir, out.fileName, bytes);
          savedNames.push(out.fileName);
        }
        const summary = `Guardado en ${payload.sourceDir}: ${savedNames.join(', ')}`;
        setContextBanner(summary);
        await bridge.completeBackgroundTask({
          ok: true,
          title: 'SPEED.PDF — Proceso completado',
          body: summary,
        });
      } else {
        await bridge.completeBackgroundTask({
          ok: false,
          title: 'SPEED.PDF — No se pudo completar',
          body:
            capturedError ||
            'Verifica que los archivos seleccionados no estén dañados ni protegidos.',
        });
      }
    } catch (err) {
      await bridge.completeBackgroundTask({
        ok: false,
        title: 'SPEED.PDF — Error al procesar',
        body: err instanceof Error ? err.message : 'Error inesperado en segundo plano.',
      });
    }
  };

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    void bridge.getShellStatus().then(setShellStatus).catch(() => {});
    const unsubscribe = bridge.onShellLaunchArgs((payload) => {
      void desktopHandlerRef.current(payload);
    });
    bridge.signalReady();
    return unsubscribe;
  }, []);

  const handleToggleDesktopShell = async (install: boolean) => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    setShellBusy(true);
    setShellFeedback(null);
    try {
      const next = install ? await bridge.installShellMenu() : await bridge.uninstallShellMenu();
      setShellStatus(next);
      setShellFeedback(
        next.integrated
          ? 'Menú contextual SPEED.PDF integrado correctamente en el Explorador de Windows.'
          : 'Entradas de SPEED.PDF eliminadas del menú contextual de Windows.'
      );
    } catch (err) {
      setShellFeedback(
        err instanceof Error
          ? `No se pudo actualizar el registro de Windows: ${err.message}`
          : 'No se pudo actualizar el registro de Windows.'
      );
    } finally {
      setShellBusy(false);
    }
  };

  const currentMeta = TOOL_METADATA[activeTool];
  const totalQueueBytes = useMemo(() => queue.reduce((sum, q) => sum + q.size, 0), [queue]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <TopBar
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        onTriggerFilePicker={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={currentMeta.acceptAttr}
        onChange={handleFileInputChange}
        className="sr-only"
      />

      <main className="flex-1 flex flex-col">
        <div className="flex-1 max-w-[1440px] w-full mx-auto flex flex-col lg:flex-row">
          <WorkspaceSidebar
            activeTool={activeTool}
            onSelectTool={handleSelectTool}
            theme={theme}
            onSetTheme={setTheme}
            onOpenUpdates={() => setIsUpdateModalOpen(true)}
            onOpenWindowsIntegration={() => {
              setShellFeedback(null);
              setIsShellModalOpen(true);
            }}
            windowsShellActive={shellStatus ? shellStatus.integrated : null}
          />

            <div className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-5">
              {/* Minimalist Tool Header */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1 max-w-2xl">
                  <h1 className="text-xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
                    {currentMeta.title}
                  </h1>
                  <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                    {currentMeta.description}
                  </p>
                </div>

                {activeTool === 'organize'
                  ? organizerFiles.length > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                        {organizerPages.length} pág(s) · {organizerFiles.length} PDF(s)
                      </div>
                    )
                  : queue.length > 0 && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                        {queue.length} archivo(s) · {formatBytes(totalQueueBytes)}
                      </div>
                    )}
              </div>

              {contextBanner && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-2.5 text-xs text-blue-900 dark:text-blue-200 flex items-center justify-between gap-3">
                  <span>{contextBanner}</span>
                  <button
                    type="button"
                    onClick={() => setContextBanner(null)}
                    className="font-medium underline shrink-0"
                  >
                    Ocultar
                  </button>
                </div>
              )}

              {activeTool === 'organize' ? (
                <OrganizePagesGrid
                  sourceFiles={organizerFiles}
                  pages={organizerPages}
                  isLoadingThumbnails={organizerLoadingCount > 0}
                  onAddPdfFiles={(files) => {
                    void addPdfFilesToOrganizer(files);
                  }}
                  onReorderPage={handleReorderOrganizerPage}
                  onMovePageStep={handleMoveOrganizerPageStep}
                  onRotatePage={handleRotateOrganizerPage}
                  onRotateFilePages={handleRotateOrganizerFilePages}
                  onRemovePage={handleRemoveOrganizerPage}
                  onRemoveFile={handleRemoveOrganizerFile}
                  onGroupByFile={handleGroupOrganizerByFile}
                  onResetAllPages={handleResetOrganizerPages}
                  onClearAll={handleClearOrganizer}
                  onLoadSample={() => {
                    void handleLoadSample();
                  }}
                />
              ) : (
                <FileQueuePanel
                  activeTool={activeTool}
                  items={queue}
                  onAddFiles={(files) => {
                    void addFilesToQueue(files);
                  }}
                  onRemoveItem={handleRemoveItem}
                  onReorderItem={handleReorderItem}
                  onRotateItem={handleRotateItem}
                  onUpdatePageRange={handleUpdatePageRange}
                  onClearAll={() => {
                    queue.forEach((q) => {
                      if (q.thumbnailUrl?.startsWith('blob:')) {
                        URL.revokeObjectURL(q.thumbnailUrl);
                      }
                    });
                    setQueue([]);
                    setOutputs([]);
                  }}
                  onLoadSample={() => {
                    void handleLoadSample();
                  }}
                  acceptedHint={currentMeta.acceptedHint}
                />
              )}

              <ToolSettingsPanel
                activeTool={activeTool}
                hasFiles={queue.length > 0}
                fileCount={queue.length}
                isProcessing={progress.active}
                compression={compression}
                onChangeCompression={setCompression}
                mergeOutputName={mergeOutputName}
                onChangeMergeOutputName={setMergeOutputName}
                mergeStripMetadata={mergeStripMetadata}
                onChangeMergeStripMetadata={setMergeStripMetadata}
                organizeOutputName={organizeOutputName}
                onChangeOrganizeOutputName={setOrganizeOutputName}
                organizeStripMetadata={organizeStripMetadata}
                onChangeOrganizeStripMetadata={setOrganizeStripMetadata}
                organizerPageCount={organizerPages.length}
                organizerFileCount={organizerFiles.length}
                rotateStripMetadata={rotateStripMetadata}
                onChangeRotateStripMetadata={setRotateStripMetadata}
                onRotateAll={handleRotateAll}
                onResetRotations={handleResetRotations}
                imageExport={imageExport}
                onChangeImageExport={setImageExport}
                imageToPdf={imageToPdf}
                onChangeImageToPdf={setImageToPdf}
                wordSettings={wordSettings}
                onChangeWordSettings={setWordSettings}
                vaultMode={vaultMode}
                onChangeVaultMode={setVaultMode}
                batchConvertMode={batchConvertMode}
                onChangeBatchConvertMode={setBatchConvertMode}
                batchOutputName={batchOutputName}
                onChangeBatchOutputName={setBatchOutputName}
                encryptOutput={encryptOutput}
                onChangeEncryptOutput={setEncryptOutput}
                vaultPassword={vaultPassword}
                onChangeVaultPassword={setVaultPassword}
                onExecute={() => {
                  void executeToolWithItems(activeTool, queue);
                }}
              />

              <OutputPanel
                progress={progress}
                outputs={outputs}
                errorMessage={errorMessage}
                onDismissError={() => setErrorMessage(null)}
                onDismissOutputs={() => setOutputs([])}
              />
            </div>
          </div>
      </main>

      {isShellModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Integración con Explorador de Windows"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <FolderCog className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                  Menú contextual en Explorador de Windows
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsShellModalOpen(false)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar integración Windows"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Al hacer clic derecho sobre archivos en el Explorador de Windows aparecerá el submenú{' '}
              <strong className="text-slate-800 dark:text-slate-200">SPEED.PDF</strong> adaptado automáticamente al tipo de archivo seleccionado:
            </p>

            <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
              <li>
                <strong className="font-mono text-slate-800 dark:text-slate-100">.pdf</strong> → Comprimir, Personalizar, Unir PDFs, Convertir a Word o JPG
              </li>
              <li>
                <strong className="font-mono text-slate-800 dark:text-slate-100">.docx</strong> → Convertir a PDF, Unir en 1 PDF o PDFs separados
              </li>
              <li>
                <strong className="font-mono text-slate-800 dark:text-slate-100">.jpg / .png</strong> → Convertir a PDF, Unir imágenes o PDFs separados
              </li>
              <li>
                <strong className="font-mono text-slate-800 dark:text-slate-100">Lote mixto</strong> → Convertir todos en un solo PDF o cada archivo por separado
              </li>
            </ul>

            {shellStatus?.supported ? (
              <div className="space-y-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                  Ejecutable: {shellStatus.exePath}
                </div>

                {(shellStatus.ffmpegPresent === false ||
                  shellStatus.isTempExe ||
                  shellStatus.registeredHealthy === false) && (
                  <p className="text-xs text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                    {shellStatus.isTempExe
                      ? 'SPEED.PDF se ejecutó desde la carpeta temporal (Temp). Usa el instalador SPEED.PDF-Setup o mueve SPEED.PDF-Portable a una carpeta fija antes de activar el menú.'
                      : 'No se detectó ffmpeg.dll junto al ejecutable registrado. Si Windows mostró error de ffmpeg.dll, reinstala SPEED.PDF-Setup o restaura el archivo desde Protección contra virus y amenazas en Seguridad de Windows.'}
                  </p>
                )}

                {shellStatus.isPortable &&
                  !shellStatus.isTempExe &&
                  !/speed\.pdf\.exe$/i.test(shellStatus.exePath) && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
                      Estás usando la versión Portable. Para unir varios archivos a la vez desde el menú contextual sin re-extraer en Temp (y evitar bloqueos de ffmpeg.dll), se recomienda instalar <strong>SPEED.PDF-Setup</strong>.
                    </p>
                  )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={shellBusy}
                    onClick={() => void handleToggleDesktopShell(true)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>
                      {shellStatus.integrated
                        ? 'Actualizar / Reparar menú en Windows'
                        : 'Activar menú en Windows'}
                    </span>
                  </button>
                  {shellStatus.integrated && (
                    <button
                      type="button"
                      disabled={shellBusy}
                      onClick={() => void handleToggleDesktopShell(false)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Quitar de Windows</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    triggerBlobDownload(
                      new Blob(
                        [
                          generateInstallRegistryScript({
                            installPath: 'C:\\Program Files\\SPEED.PDF\\SPEED.PDF.exe',
                          }),
                        ],
                        { type: 'text/plain;charset=utf-8' }
                      ),
                      'install_speedpdf_context_menu.reg'
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar registro Windows (.reg)</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerBlobDownload(
                      new Blob([generateUninstallRegistryScript()], {
                        type: 'text/plain;charset=utf-8',
                      }),
                      'uninstall_speedpdf_context_menu.reg'
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <span>Desinstalar (.reg)</span>
                </button>
              </div>
            )}

            {shellFeedback && (
              <p className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 rounded-lg px-3 py-2">
                {shellFeedback}
              </p>
            )}

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Nota: En Windows 11 aparecerá bajo &ldquo;Mostrar más opciones&rdquo; (o directamente en el menú clásico).
            </p>
          </div>
        </div>
      )}

      {isUpdateModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Buscar actualizaciones de SPEED.PDF"
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-display font-semibold text-slate-900 dark:text-slate-100">
                Centro de actualizaciones SPEED.PDF
              </span>
              <button
                type="button"
                onClick={() => setIsUpdateModalOpen(false)}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Cerrar actualizaciones"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <UpdateCheckerPanel compact />
          </div>
        </div>
      )}
    </div>
  );
}
