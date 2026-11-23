export type AppSection = 'workspace' | 'converter';

export type PdfToolId =
  | 'compress'
  | 'merge'
  | 'organize'
  | 'rotate'
  | 'protect'
  | 'unlock'
  | 'batch-to-pdf'
  | 'pdf-to-img'
  | 'img-to-pdf'
  | 'pdf-to-word'
  | 'word-to-pdf'
  | 'vault';

export type RotationAngle = 0 | 90 | 180 | 270;

export type BatchConvertMode = 'single-pdf' | 'separate-pdfs';

export type CompressionPreset = 'extreme' | 'balanced' | 'high' | 'lossless' | 'custom';

export type ImageExportFormat = 'jpeg' | 'png';

export type PageSizeOption = 'a4' | 'letter' | 'fit';
export type PageOrientation = 'auto' | 'portrait' | 'landscape';

export interface QueueFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: 'pdf' | 'image' | 'docx' | 'vault';
  pageCount?: number;
  pageRange: string;
  rotation?: RotationAngle;
  thumbnailUrl?: string;
  requiresPassword?: boolean;
  sourcePath?: string;
  addedAt: number;
}

export interface OrganizerSourceFile {
  id: string;
  file: File;
  name: string;
  size: number;
  pageCount: number;
  colorIndex: number;
}

export interface OrganizerPageItem {
  id: string;
  sourceFileId: string;
  sourceFileName: string;
  colorIndex: number;
  originalPageNumber: number;
  rotation: RotationAngle;
  thumbnailUrl?: string;
  thumbnailStatus?: 'loading' | 'ready' | 'failed';
}

export interface CompressionSettings {
  preset: CompressionPreset;
  dpi: number;
  jpegQuality: number;
  stripMetadata: boolean;
  structuralOnly: boolean;
}

export interface ProtectPdfSettings {
  openPassword: string;
  ownerPassword: string;
  allowPrinting: boolean;
  allowCopying: boolean;
  allowModifying: boolean;
  stripMetadata: boolean;
}

export interface UnlockPdfSettings {
  password: string;
  dpi: number;
  jpegQuality: number;
  stripMetadata: boolean;
}

export interface ImageExportSettings {
  format: ImageExportFormat;
  dpi: number;
  quality: number;
  bundleAsZip: boolean;
}

export interface ImageToPdfSettings {
  pageSize: PageSizeOption;
  orientation: PageOrientation;
  marginPt: number;
  jpegQuality: number;
}

export interface WordConversionSettings {
  preservePageBreaks: boolean;
  fontSize: number;
  pageSize: 'a4' | 'letter';
  fidelityMode: 'editable' | 'visual';
}

export interface ProcessedOutput {
  id: string;
  tool: PdfToolId;
  fileName: string;
  mimeType: string;
  blob: Blob;
  originalSize: number;
  outputSize: number;
  durationMs: number;
  pageCount?: number;
  encrypted?: boolean;
  summary: string;
  createdAt: number;
}

export interface ProgressState {
  active: boolean;
  percent: number;
  stage: string;
  currentPage?: number;
  totalPages?: number;
}

export type WindowsTargetVersion = 'win7' | 'win10' | 'win11';

export interface ExplorerSimFile {
  id: string;
  name: string;
  extension: 'pdf' | 'docx' | 'jpg' | 'png' | 'zip';
  size: number;
  modified: string;
  realFile?: File;
  isGeneratedOutput?: boolean;
}
