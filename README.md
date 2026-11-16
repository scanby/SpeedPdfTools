# SPEED.PDF

Estación de trabajo local minimalista para compresión, fusión y conversión cifrada de archivos PDF, diseñada con arquitectura modular y soporte de integración contextual para Windows 7 SP1 hasta Windows 11.

## Capacidades del prototipo actual

- **Comprimir PDF localmente**: Optimización estructural sin pérdida (conserva texto seleccionable) o recompresión visual configurable (`72–300 DPI` y calidad JPEG `35%–95%`) con eliminación opcional de metadatos privados.
- **Unir múltiples PDFs**: Reordenamiento de archivos en cola, selección de rangos de páginas por documento (p. ej. `1-3, 5`) y vista previa en miniatura.
- **Conversión bidireccional local**:
  - **PDF a JPG / PNG**: Exportación por página a resolución configurable o empaquetado automático en `.zip`.
  - **JPG / PNG a PDF**: Conversión por lotes con control de tamaño de página (`A4`, `Carta`, `Ajustar a imagen`), orientación y márgenes.
  - **PDF a Word (`.docx`) y Word (`.docx`) a PDF**: Extracción de jerarquía de texto hacia `.docx` editable y maquetación local de `.docx` hacia PDF paginado.
- **Privacidad y bóveda AES-256-GCM**: Procesamiento 100% en memoria del dispositivo (sin subidas a servidores) y cifrado/descifrado local mediante Web Crypto API (`PBKDF2-SHA256` + `AES-256-GCM`, formato `.speedvault`).
- **Integración con Explorador de Windows (7–11)**: Simulador interactivo de menú contextual y generador descargable de scripts reales `.reg` (`HKCU\Software\Classes` con `MultiSelectModel`) y despachador IPC en PowerShell (`.ps1`).

## Estructura modular

```text
src/
  core/
    pdfEngine.ts       # Inspección, compresión, fusión e imágenes PDF por fragmentos
    docxBridge.ts      # Conversión bidireccional local PDF <-> DOCX
    cryptoVault.ts     # Cifrado y descifrado local AES-256-GCM (Web Crypto API)
    windowsShell.ts    # Generador de registro Windows (.reg) y despachador IPC (.ps1)
    sampleFactory.ts   # Generador local de documentos de muestra para pruebas
    formatters.ts      # Utilidades de formato, rangos de páginas y saneamiento WinAnsi
  components/
    TopBar.tsx
    WorkspaceSidebar.tsx
    FileQueuePanel.tsx
    ToolSettingsPanel.tsx
    OutputPanel.tsx
    WindowsExplorerView.tsx
    ArchitectureView.tsx
  types/
    speedpdf.ts
```

## Ejecución en desarrollo

```bash
npm install
npm run dev
```

Compilación de producción y verificación de tipos:

```bash
npm run lint
npm run build
```

## Repositorio remoto

Configurado para [`https://github.com/scanby/Speed-pdf.git`](https://github.com/scanby/Speed-pdf.git).
