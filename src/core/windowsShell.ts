import { WindowsTargetVersion } from '../types/speedpdf';

export interface RegistryConfig {
  targetWindows: WindowsTargetVersion;
  installPath: string;
  enableAutoConvert: boolean;
  enableCustomCompress: boolean;
  enableMergeSelected: boolean;
  enablePdfToWord: boolean;
}

function escapeRegPath(path: string): string {
  return path.replace(/\\/g, '\\\\');
}

export function generateInstallRegistryScript(config: RegistryConfig): string {
  const exe = escapeRegPath(config.installPath.trim() || 'C:\\Program Files\\SPEED.PDF\\speedpdf.exe');
  const lines: string[] = [
    'Windows Registry Editor Version 5.00',
    '; ============================================================================',
    `; SPEED.PDF — Integracion con Explorador de Windows (${config.targetWindows.toUpperCase()})`,
    '; Compatible con Windows 7 SP1, Windows 8.1, Windows 10 y Windows 11',
    '; Procesamiento 100% local y cifrado en el dispositivo',
    '; ============================================================================',
    '',
  ];

  const imageExts = ['.jpg', '.jpeg', '.png'];
  const docExts = ['.docx'];

  if (config.enableAutoConvert) {
    for (const ext of [...docExts, ...imageExts]) {
      lines.push(
        `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\SpeedPdfAutoConvert]`,
        `@="SPEED.PDF: Convertir a PDF automaticamente"`,
        `"Icon"="${exe},0"`,
        `"MultiSelectModel"="Player"`,
        '',
        `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\${ext}\\shell\\SpeedPdfAutoConvert\\command]`,
        `@="\\"${exe}\\" --auto-convert --format=pdf --output-dir=source --input=\\"%1\\""`,
        ''
      );
    }
  }

  if (config.enableCustomCompress) {
    lines.push(
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfCompressCustom]`,
      `@="SPEED.PDF: Comprimir con ajustes personalizados..."`,
      `"Icon"="${exe},0"`,
      `"MultiSelectModel"="Player"`,
      '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfCompressCustom\\command]`,
      `@="\\"${exe}\\" --mode=compress --ui=custom --input=\\"%1\\""`,
      ''
    );
  }

  if (config.enableMergeSelected) {
    lines.push(
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMerge]`,
      `@="SPEED.PDF: Unir archivos seleccionados"`,
      `"Icon"="${exe},0"`,
      `"MultiSelectModel"="Player"`,
      '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfMerge\\command]`,
      `@="\\"${exe}\\" --mode=merge --ipc-batch --output-dir=source --input=\\"%1\\""`,
      ''
    );
  }

  if (config.enablePdfToWord) {
    lines.push(
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfToWord]`,
      `@="SPEED.PDF: Convertir a Word (.docx)"`,
      `"Icon"="${exe},0"`,
      '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\SpeedPdfToWord\\command]`,
      `@="\\"${exe}\\" --auto-convert --format=docx --output-dir=source --input=\\"%1\\""`,
      ''
    );
  }

  if (config.enableAutoConvert || config.enableMergeSelected) {
    lines.push(
      '; Opciones globales para seleccion multiple de archivos de distinto formato',
      `[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSingle]`,
      `@="SPEED.PDF: Convertir todos en un solo PDF"`,
      `"Icon"="${exe},0"`,
      `"MultiSelectModel"="Player"`,
      '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSingle\\command]`,
      `@="\\"${exe}\\" --mode=batch-single-pdf --ipc-batch --output-dir=source --input=\\"%1\\""`,
      '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSeparate]`,
      `@="SPEED.PDF: Convertir cada archivo en un PDF por separado"`,
      `"Icon"="${exe},0"`,
      `"MultiSelectModel"="Player"`,
      '',
      `[HKEY_CURRENT_USER\\Software\\Classes\\*\\shell\\SpeedPdfBatchSeparate\\command]`,
      `@="\\"${exe}\\" --mode=batch-separate-pdfs --ipc-batch --output-dir=source --input=\\"%1\\""`,
      ''
    );
  }

  if (config.targetWindows === 'win11') {
    lines.push(
      '; Nota Windows 11: Si deseas mostrar el menu clasico directamente sin pulsar',
      '; "Mostrar mas opciones", registra un paquete MSIX Sparse con IExplorerCommand',
      '; o habilita la clave de menu clasico en HKCU.',
      ''
    );
  }

  return lines.join('\r\n');
}

export function generateUninstallRegistryScript(): string {
  const keys = [
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
  SPEED.PDF — Despachador Local IPC para Menú Contextual de Windows (Win 7–11)
  Recibe múltiples archivos seleccionados desde Explorer (%1) mediante Named Pipe
  sin lanzar instancias duplicadas que consuman RAM innecesaria.
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

# Resuelve automáticamente la carpeta del archivo original cuando OutputDir = "source"
$ResolvedOutputDir = if ($OutputDir -eq "source" -and $InputFiles.Count -gt 0) {
  Split-Path -Parent $InputFiles[0]
} else {
  $OutputDir
}

$PipeName = "SpeedPdfSingleInstancePipe"
$Payload = @{
  mode = $Mode
  format = $Format
  outputDir = $ResolvedOutputDir
  autoConvert = [bool]$AutoConvert
  customUi = [bool]$CustomUI
  files = $InputFiles
  timestamp = (Get-Date).ToString("o")
} | ConvertTo-Json -Compress

try {
  $Pipe = New-Object System.IO.Pipes.NamedPipeClientStream(".", $PipeName, [System.IO.Pipes.PipeDirection]::Out)
  $Pipe.Connect(350)
  $Writer = New-Object System.IO.StreamWriter($Pipe)
  $Writer.WriteLine($Payload)
  $Writer.Flush()
  $Pipe.Close()
} catch {
  # Si SPEED.PDF no está en memoria, inicia una única instancia ligera y guarda en $ResolvedOutputDir
  $ExePath = Join-Path $PSScriptRoot "speedpdf.exe"
  Write-Host "Iniciando SPEED.PDF en modo local. Salida automática en: $ResolvedOutputDir"
}
`;
}
