import { X } from 'lucide-react';
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { ArchitectureView } from './components/ArchitectureView';
import { FileQueuePanel } from './components/FileQueuePanel';
import { OutputPanel } from './components/OutputPanel';
import { ToolSettingsPanel } from './components/ToolSettingsPanel';
import { TopBar } from './components/TopBar';
import { UpdateCheckerPanel } from './components/UpdateCheckerPanel';
import { ContextMenuActionType, WindowsExplorerView } from './components/WindowsExplorerView';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import {
  convertMixedBatchToSeparatePdfs,
  convertMixedBatchToSinglePdf,
} from './core/batchPdfEngine';
import { decryptVaultLocal, encryptBlobLocal } from './core/cryptoVault';
import { docxToPdf, pdfToDocx } from './core/docxBridge';
import { formatBytes, stripExtension, triggerSequentialDownloads } from './core/formatters';
import {
  compressPdf,
  imagesToPdf,
  inspectImageFile,
  inspectPdfFile,
  mergePdfs,
  pdfToImages,
} from './core/pdfEngine';
import {
  createSampleDocxFile,
  createSampleImageFile,
  createSamplePdfFile,
} from './core/sampleFactory';
import {
  AppSection,
  BatchConvertMode,
  CompressionSettings,
  ExplorerSimFile,
  ImageExportSettings,
  ImageToPdfSettings,
  PdfToolId,
  ProcessedOutput,
  ProgressState,
  QueueFileItem,
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
      'Combina documentos en un único PDF, ajusta su orden de lectura y selecciona rangos de páginas específicos.',
    acceptedHint: '2 o más archivos PDF (.pdf)',
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const handleSelectSection = (section: AppSection) => {
    setActiveSection(section);
    if (section === 'workspace' && !['compress', 'merge', 'vault'].includes(activeTool)) {
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
    if (['compress', 'merge', 'vault'].includes(tool)) {
      setActiveSection('workspace');
    } else {
      setActiveSection('converter');
    }
  };

  const addFilesToQueue = async (fileList: FileList | File[], replace = false): Promise<QueueFileItem[]> => {
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
      addedAt: Date.now(),
    }));

    setQueue((prev) => (replace ? newItems : [...prev, ...newItems]));

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
      void addFilesToQueue(e.target.files);
      if (activeSection === 'windows' || activeSection === 'architecture') {
        setActiveSection('workspace');
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

  const handleMoveItem = (id: string, direction: 'up' | 'down') => {
    setQueue((prev) => {
      const idx = prev.findIndex((i) => i.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(swapIdx, 0, moved);
      return copy;
    });
  };

  const handleUpdatePageRange = (id: string, pageRange: string) => {
    setQueue((prev) => prev.map((item) => (item.id === id ? { ...item, pageRange } : item)));
  };

  const handleLoadSample = async () => {
    setErrorMessage(null);
    if (activeTool === 'merge') {
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
    batchModeOverride?: BatchConvertMode
  ): Promise<ProcessedOutput[]> => {
    if (itemsToProcess.length === 0) return [];
    setErrorMessage(null);

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
          const res = await compressPdf(item.file, compression, setProgress);
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
        const res = await mergePdfs(pdfItems, mergeStripMetadata, mergeOutputName, setProgress);
        const out = await maybeEncrypt(
          res.blob,
          res.fileName,
          totalInSize,
          `Unión de ${pdfItems.length} archivos (${res.pageCount} pág.)`,
          res.pageCount
        );
        createdOutputs.push(out);
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
            setProgress
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
            setProgress
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
        for (const item of pdfItems) {
          const res = await pdfToImages(item.file, imageExport, setProgress);
          const out = await maybeEncrypt(
            res.blob,
            res.fileName,
            item.size,
            `Exportado a ${imageExport.format.toUpperCase()} · ${imageExport.dpi} DPI (${res.pageCount} pág.)`,
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
          setProgress
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
          const res = await pdfToDocx(item.file, wordSettings, setProgress);
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
          const res = await docxToPdf(item.file, wordSettings, setProgress);
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
          setProgress({
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
        setProgress({ active: false, percent: 100, stage: 'Completado' });
      }

      setOutputs((prev) => [...createdOutputs, ...prev]);
      return createdOutputs;
    } catch (err) {
      setProgress({ active: false, percent: 0, stage: '' });
      setErrorMessage(
        err instanceof Error ? err.message : 'Ocurrió un error al procesar el archivo.'
      );
      return [];
    }
  };

  const materializeSimFiles = async (simFiles: ExplorerSimFile[]): Promise<File[]> => {
    const out: File[] = [];
    for (const sf of simFiles) {
      if (sf.realFile) {
        out.push(sf.realFile);
      } else if (sf.extension === 'pdf') {
        out.push(await createSamplePdfFile(sf.name, 3));
      } else if (sf.extension === 'docx') {
        out.push(await createSampleDocxFile(sf.name));
      } else {
        out.push(await createSampleImageFile(sf.name));
      }
    }
    return out;
  };

  const handleExplorerContextAction = async (
    action: ContextMenuActionType,
    simFiles: ExplorerSimFile[],
    linkedDirectory?: {
      name: string;
      getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<{
        createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
      }>;
    } | null
  ): Promise<ExplorerSimFile[]> => {
    const files = await materializeSimFiles(simFiles);
    if (files.length === 0) return [];

    let targetTool: PdfToolId = 'compress';
    let autoRun = false;
    let batchModeOverride: BatchConvertMode | undefined;

    if (action === 'auto-compress') {
      targetTool = 'compress';
      autoRun = true;
    } else if (action === 'custom-compress') {
      targetTool = 'compress';
      autoRun = false;
    } else if (action === 'merge-selected') {
      targetTool = 'merge';
      autoRun = true;
    } else if (action === 'merge-images') {
      targetTool = 'img-to-pdf';
      autoRun = true;
    } else if (action === 'convert-all-single-pdf') {
      targetTool = 'batch-to-pdf';
      batchModeOverride = 'single-pdf';
      setBatchConvertMode('single-pdf');
      autoRun = true;
    } else if (action === 'convert-all-separate-pdfs') {
      targetTool = 'batch-to-pdf';
      batchModeOverride = 'separate-pdfs';
      setBatchConvertMode('separate-pdfs');
      autoRun = true;
    } else if (action === 'auto-to-word') {
      targetTool = 'pdf-to-word';
      autoRun = true;
    } else if (action === 'auto-to-jpg') {
      targetTool = 'pdf-to-img';
      autoRun = true;
    } else if (action === 'auto-to-pdf') {
      targetTool = simFiles[0]?.extension === 'docx' ? 'word-to-pdf' : 'img-to-pdf';
      autoRun = true;
    } else {
      const hasMultipleTypes = new Set(simFiles.map((s) => s.extension)).size > 1;
      const firstExt = simFiles[0]?.extension;
      targetTool = hasMultipleTypes
        ? 'batch-to-pdf'
        : firstExt === 'docx'
        ? 'word-to-pdf'
        : firstExt === 'pdf'
        ? 'compress'
        : 'img-to-pdf';
      autoRun = false;
    }

    if (!autoRun) {
      handleSelectTool(targetTool);
      await addFilesToQueue(files, true);
      setContextBanner(
        'Archivo(s) cargados desde Explorador de Windows para personalizar ajustes antes de procesar.'
      );
      return [];
    }

    // Conversión automática directa desde clic derecho: procesa y descarga/guarda en el directorio origen
    const items: QueueFileItem[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      kind: detectFileKind(file),
      pageRange: 'Todas',
      addedAt: Date.now(),
    }));

    const created = await executeToolWithItems(targetTool, items, batchModeOverride);
    if (created.length === 0) return [];

    let savedDirectlyToFolder = false;
    if (linkedDirectory) {
      try {
        for (const out of created) {
          const handle = await linkedDirectory.getFileHandle(out.fileName, { create: true });
          const writable = await handle.createWritable();
          await writable.write(out.blob);
          await writable.close();
        }
        savedDirectlyToFolder = true;
      } catch {
        savedDirectlyToFolder = false;
      }
    }

    if (!savedDirectlyToFolder) {
      triggerSequentialDownloads(
        created.map((out) => ({ blob: out.blob, fileName: out.fileName }))
      );
    }

    return created.map((out) => {
      const lower = out.fileName.toLowerCase();
      const extension: ExplorerSimFile['extension'] = lower.endsWith('.docx')
        ? 'docx'
        : lower.endsWith('.zip')
        ? 'zip'
        : lower.endsWith('.png')
        ? 'png'
        : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
        ? 'jpg'
        : 'pdf';

      return {
        id: `gen-${out.id}`,
        name: out.fileName,
        extension,
        size: out.outputSize,
        modified: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        realFile: new File([out.blob], out.fileName, { type: out.mimeType }),
        isGeneratedOutput: true,
      };
    });
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
        accept={
          activeSection === 'workspace' || activeSection === 'converter'
            ? currentMeta.acceptAttr
            : '.pdf,.docx,.jpg,.jpeg,.png,.speedvault'
        }
        onChange={handleFileInputChange}
        className="sr-only"
      />

      <main className="flex-1 flex flex-col">
        {activeSection === 'windows' ? (
          <WindowsExplorerView
            progress={progress}
            onExecuteContextAction={handleExplorerContextAction}
          />
        ) : activeSection === 'architecture' ? (
          <ArchitectureView />
        ) : (
          <div className="flex-1 max-w-[1440px] w-full mx-auto flex flex-col lg:flex-row">
            <WorkspaceSidebar
              activeTool={activeTool}
              onSelectTool={handleSelectTool}
              theme={theme}
              onSetTheme={setTheme}
              onOpenUpdates={() => setIsUpdateModalOpen(true)}
            />

            <div className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 space-y-6">
              {/* Contextual Workspace Breadcrumb & Header */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div className="space-y-1 max-w-2xl">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>SPEED.PDF</span>
                    <span aria-hidden="true">/</span>
                    <span>
                      {activeSection === 'workspace' ? 'Estación PDF' : 'Conversor local'}
                    </span>
                    <span aria-hidden="true">/</span>
                    <span className="text-slate-800 dark:text-slate-200 font-medium">
                      {currentMeta.title}
                    </span>
                  </div>
                  <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-slate-50 text-balance">
                    {currentMeta.title}
                  </h1>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {currentMeta.description}
                  </p>
                </div>

                <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                  {queue.length} archivo(s) · {formatBytes(totalQueueBytes)} en cola
                </div>
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

              <FileQueuePanel
                activeTool={activeTool}
                items={queue}
                onAddFiles={(files) => {
                  void addFilesToQueue(files);
                }}
                onRemoveItem={handleRemoveItem}
                onMoveItem={handleMoveItem}
                onUpdatePageRange={handleUpdatePageRange}
                onClearAll={() => {
                  queue.forEach((q) => {
                    if (q.thumbnailUrl?.startsWith('blob:')) {
                      URL.revokeObjectURL(q.thumbnailUrl);
                    }
                  });
                  setQueue([]);
                }}
                onLoadSample={() => {
                  void handleLoadSample();
                }}
                acceptedHint={currentMeta.acceptedHint}
              />

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
              />
            </div>
          </div>
        )}
      </main>

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
