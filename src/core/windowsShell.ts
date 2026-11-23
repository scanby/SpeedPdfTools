import { WindowsTargetVersion } from '../types/speedpdf';

export interface RegistryConfig {
  targetWindows?: WindowsTargetVersion;
  installPath: string;
  enableAutoConvert?: boolean;
  enableCustomCompress?: boolean;
  enableMergeSelected?: boolean;
  enablePdfToWord?: boolean;
}

function escapeRegPath(path: string): string {
  return path.replace(/\\/g, '\\\\');
}

const MIXED_APPLIES_TO =
  'System.FileExtension:=".pdf" OR System.FileExtension:=".docx" OR System.FileExtension:=".jpg" OR System.FileExtension:=".jpeg" OR System.FileExtension:=".png" OR System.FileExtension:=".webp"';

export function generateInstallRegistryScript(config: RegistryConfig): string {
  const exe = escapeRegPath(
    config.installPath.trim() || 'C:\\Program Files\\SPEED.PDF\\SPEED.PDF.exe'
  );
  const enableAuto = config.enableAutoConvert ?? true;
  const enableCompress = config.enableCustomCompress ?? true;
  const enableMerge = config.enableMergeSelected ?? true;
  const enableWord = config.enablePdfToWord ?? true;

  const lines: string[] = [
    'Windows Registry Editor Version 5.00',
    '; ============================================================================',
    `; SPEED.PDF — Menú contextual cascada en Explorador de Windows (${(config.targetWindows ?? 'win11').toUpperCase()})`,
    '; Compatible con Windows 7 SP1, Windows 8.1, Windows 10 y Windows 11 (HKCU sin UAC)',
    '; ============================================================================',
    '',
  ];

  // 1. Submenú para archivos PDF (.pdf)
  lines.push(
    '[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu]',
    '"MUIVerb"="SPEED.PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '"ExtendedSubCommandsKey"="SpeedPdf.PdfMenu"',
    ''
  );

  if (enableCompress) {
    lines.push(
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\01_CompressAuto]',
      '"MUIVerb"="Comprimir automáticamente"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\01_CompressAuto\\command]',
      `@="\\"${exe}\\" --mode=compress --auto-convert --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\02_CompressCustom]',
      '"MUIVerb"="Personalizar compresión..."',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\02_CompressCustom\\command]',
      `@="\\"${exe}\\" --mode=compress --ui=custom --input=\\"%1\\""`,
      ''
    );
  }

  if (enableMerge) {
    lines.push(
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\03_Merge]',
      '"MUIVerb"="Unir PDFs seleccionados"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\03_Merge\\command]',
      `@="\\"${exe}\\" --mode=merge --auto-convert --output-dir=source --input=\\"%1\\""`,
      ''
    );
  }

  if (enableWord) {
    lines.push(
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\04_ToWord]',
      '"MUIVerb"="Convertir a Word (.docx)"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\04_ToWord\\command]',
      `@="\\"${exe}\\" --mode=pdf-to-word --auto-convert --format=docx --output-dir=source --input=\\"%1\\""`,
      ''
    );
  }

  if (enableAuto) {
    lines.push(
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg]',
      '"MUIVerb"="Convertir páginas a JPG"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\05_ToJpg\\command]',
      `@="\\"${exe}\\" --mode=pdf-to-img --auto-convert --format=jpg --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\06_Unlock]',
      '"MUIVerb"="Desproteger PDF"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\06_Unlock\\command]',
      `@="\\"${exe}\\" --mode=unlock --auto-convert --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\07_Organize]',
      '"MUIVerb"="Ordenar páginas PDF..."',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu\\shell\\07_Organize\\command]',
      `@="\\"${exe}\\" --mode=organize --ui=custom --input=\\"%1\\""`,
      ''
    );
  }

  // 2. Submenú para documentos Word (.docx)
  if (enableAuto) {
    lines.push(
      '[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.docx\\shell\\SpeedPdfMenu]',
      '"MUIVerb"="SPEED.PDF"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '"ExtendedSubCommandsKey"="SpeedPdf.DocxMenu"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\01_ToPdf]',
      '"MUIVerb"="Convertir a PDF automáticamente"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\01_ToPdf\\command]',
      `@="\\"${exe}\\" --mode=word-to-pdf --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\02_BatchSingle]',
      '"MUIVerb"="Convertir todos en un solo PDF"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\02_BatchSingle\\command]',
      `@="\\"${exe}\\" --mode=batch-single-pdf --auto-convert --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\03_BatchSeparate]',
      '"MUIVerb"="Convertir cada archivo en un PDF por separado"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\03_BatchSeparate\\command]',
      `@="\\"${exe}\\" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\04_Custom]',
      '"MUIVerb"="Abrir y ajustar formato..."',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu\\shell\\04_Custom\\command]',
      `@="\\"${exe}\\" --mode=word-to-pdf --ui=custom --input=\\"%1\\""`,
      ''
    );

    // 3. Submenú para imágenes (.jpg, .jpeg, .png, .webp)
    for (const imgExt of ['.jpg', '.jpeg', '.png', '.webp']) {
      lines.push(
        `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\${imgExt}\\shell\\SpeedPdfMenu]`,
        '"MUIVerb"="SPEED.PDF"',
        `"Icon"="${exe},0"`,
        '"MultiSelectModel"="Player"',
        '"ExtendedSubCommandsKey"="SpeedPdf.ImageMenu"',
        ''
      );
    }

    lines.push(
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\01_ToPdf]',
      '"MUIVerb"="Convertir a PDF automáticamente"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\01_ToPdf\\command]',
      `@="\\"${exe}\\" --mode=img-to-pdf --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\02_BatchSingle]',
      '"MUIVerb"="Unir imágenes en un solo PDF"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\02_BatchSingle\\command]',
      `@="\\"${exe}\\" --mode=batch-single-pdf --auto-convert --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\03_BatchSeparate]',
      '"MUIVerb"="Convertir cada imagen en un PDF por separado"',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\03_BatchSeparate\\command]',
      `@="\\"${exe}\\" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input=\\"%1\\""`,
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\04_Custom]',
      '"MUIVerb"="Configurar página y márgenes..."',
      `"Icon"="${exe},0"`,
      '"MultiSelectModel"="Player"',
      '',
      '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu\\shell\\04_Custom\\command]',
      `@="\\"${exe}\\" --mode=img-to-pdf --ui=custom --input=\\"%1\\""`,
      ''
    );
  }

  // 4. Submenú para selección múltiple mixta (.pdf + .docx + imágenes combinados)
  lines.push(
    '[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchMenu]',
    '"MUIVerb"="SPEED.PDF (Lote mixto)"',
    `"Icon"="${exe},0"`,
    `"AppliesTo"="${MIXED_APPLIES_TO.replace(/"/g, '\\"')}"`,
    '"MultiSelectModel"="Player"',
    '"ExtendedSubCommandsKey"="SpeedPdf.BatchMenu"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\01_BatchSingle]',
    '"MUIVerb"="Convertir todos en un solo PDF"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\01_BatchSingle\\command]',
    `@="\\"${exe}\\" --mode=batch-single-pdf --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\02_BatchSeparate]',
    '"MUIVerb"="Convertir cada archivo en un PDF por separado"',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\02_BatchSeparate\\command]',
    `@="\\"${exe}\\" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input=\\"%1\\""`,
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\03_OpenBatch]',
    '"MUIVerb"="Abrir lote en SPEED.PDF..."',
    `"Icon"="${exe},0"`,
    '"MultiSelectModel"="Player"',
    '',
    '[HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu\\shell\\03_OpenBatch\\command]',
    `@="\\"${exe}\\" --mode=batch-single-pdf --ui=custom --input=\\"%1\\""`,
    ''
  );

  return lines.join('\r\n');
}

export function generateUninstallRegistryScript(): string {
  const keys = [
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.docx\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpeg\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.png\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.webp\\shell\\SpeedPdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.PdfMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.DocxMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.ImageMenu]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SpeedPdf.BatchMenu]',
    // Limpieza de claves heredadas de v0.1.0
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.docx\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpg\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.jpeg\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.png\\shell\\SpeedPdfAutoConvert]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfCompressCustom]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMerge]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfToWord]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSingle]',
    '[-HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSeparate]',
  ];

  return [
    'Windows Registry Editor Version 5.00',
    '; Desinstalador limpio de entradas contextuales de SPEED.PDF',
    '',
    ...keys,
    '',
  ].join('\r\n');
}

export function generateShellDispatcherScript(): string {
  return `<#
  SPEED.PDF — Despachador IPC de instancia única para menú contextual de Windows
#>
param(
  [string]$Mode = "compress",
  [string]$Format = "pdf",
  [string]$OutputDir = "source",
  [switch]$AutoConvert,
  [switch]$CustomUI,
  [Parameter(ValueFromRemainingArguments=$true)]
  [string[]]$InputFiles
)
Write-Host "SPEED.PDF recibe archivos directamente via single-instance lock ($Mode / $Format)."
`;
}
