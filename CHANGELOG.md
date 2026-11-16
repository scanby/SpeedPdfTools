# Historial de versiones — SPEED.PDF

## [0.1.0] — 2026-11-16

Primer lanzamiento del prototipo funcional de **SPEED.PDF**, estación de trabajo local orientada a privacidad, bajo consumo de recursos y compatibilidad con Windows 7 SP1 hasta Windows 11.

### Novedades incluidas
- **Compresión local de PDF**: Presets (*Extrema*, *Equilibrada*, *Alta calidad*, *Sin pérdida*) y ajustes personalizados (`72–300 DPI`, calidad JPEG y limpieza de metadatos).
- **Unión de PDFs**: Reordenamiento de cola, vista previa en miniatura y selección granular de rangos de páginas.
- **Lote mixto a PDF**: Conversión múltiple de archivos de distinto formato (`.pdf`, `.docx`, `.jpg`, `.png`) unidos en un solo PDF o generados en PDFs separados.
- **Conversión bidireccional local**: `PDF ↔ Word (.docx)` y `PDF ↔ JPG / PNG` con exportación directa o empaquetado `.zip`.
- **Bóveda cifrada local AES-256-GCM**: Cifrado y descifrado en el dispositivo con derivación `PBKDF2-SHA256` (`.speedvault`).
- **Integración con Explorador de Windows (7–11)**: Simulador interactivo de menú contextual con descarga automática en el directorio de origen y generador descargable de scripts `.reg` y `.ps1`.
- **Buscador manual de actualizaciones**: Verificación SemVer contra GitHub Releases, tags y `package.json`.
