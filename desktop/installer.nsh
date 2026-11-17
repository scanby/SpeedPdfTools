!macro customInstall
  ; Accesos directos en Menú Inicio (Programa + Desinstalador)
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\SPEED.PDF"
  CreateShortCut "$SMPROGRAMS\SPEED.PDF\SPEED.PDF.lnk" "$INSTDIR\SPEED.PDF.exe" "" "$INSTDIR\SPEED.PDF.exe" 0
  CreateShortCut "$SMPROGRAMS\SPEED.PDF\Desinstalar SPEED.PDF.lnk" "$INSTDIR\Uninstall SPEED.PDF.exe" "" "$INSTDIR\Uninstall SPEED.PDF.exe" 0
  SetShellVarContext current

  ; Limpia entradas planas de versiones anteriores (v0.1.0) si existen
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfCompressCustom"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMerge"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfToWord"
  DeleteRegKey HKCU "Software\Classes\*\shell\SpeedPdfBatchSingle"
  DeleteRegKey HKCU "Software\Classes\*\shell\SpeedPdfBatchSeparate"

  ; 1. Submenú cascada SPEED.PDF para archivos .pdf
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMenu" "MUIVerb" "SPEED.PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMenu" "ExtendedSubCommandsKey" "SpeedPdf.PdfMenu"

  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\01_CompressAuto" "MUIVerb" "Comprimir automaticamente"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\01_CompressAuto" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\01_CompressAuto" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\01_CompressAuto\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=compress --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\02_CompressCustom" "MUIVerb" "Personalizar compresion..."
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\02_CompressCustom" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\02_CompressCustom" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\02_CompressCustom\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=compress --ui=custom --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\03_Merge" "MUIVerb" "Unir PDFs seleccionados"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\03_Merge" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\03_Merge" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\03_Merge\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=merge --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\04_ToWord" "MUIVerb" "Convertir a Word (.docx)"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\04_ToWord" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\04_ToWord" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\04_ToWord\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=docx --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\05_ToJpg" "MUIVerb" "Convertir paginas a JPG"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\05_ToJpg" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\05_ToJpg" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.PdfMenu\shell\05_ToJpg\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=jpg --output-dir=source --input="%1"'

  ; 2. Submenú cascada SPEED.PDF para documentos .docx
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfMenu" "MUIVerb" "SPEED.PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfMenu" "ExtendedSubCommandsKey" "SpeedPdf.DocxMenu"

  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\01_ToPdf" "MUIVerb" "Convertir a PDF automaticamente"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\01_ToPdf" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\01_ToPdf" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\01_ToPdf\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\02_BatchSingle" "MUIVerb" "Convertir todos en un solo PDF"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\02_BatchSingle" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\02_BatchSingle" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\02_BatchSingle\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-single-pdf --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\03_BatchSeparate" "MUIVerb" "Convertir cada archivo en un PDF por separado"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\03_BatchSeparate" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\03_BatchSeparate" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\03_BatchSeparate\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\04_Custom" "MUIVerb" "Abrir y ajustar formato..."
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\04_Custom" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\04_Custom" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.DocxMenu\shell\04_Custom\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=word-to-pdf --ui=custom --input="%1"'

  ; 3. Submenú cascada SPEED.PDF para imágenes (.jpg, .jpeg, .png, .webp)
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfMenu" "MUIVerb" "SPEED.PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfMenu" "ExtendedSubCommandsKey" "SpeedPdf.ImageMenu"

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfMenu" "MUIVerb" "SPEED.PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfMenu" "ExtendedSubCommandsKey" "SpeedPdf.ImageMenu"

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfMenu" "MUIVerb" "SPEED.PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfMenu" "ExtendedSubCommandsKey" "SpeedPdf.ImageMenu"

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\SpeedPdfMenu" "MUIVerb" "SPEED.PDF"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\SpeedPdfMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\SpeedPdfMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.webp\shell\SpeedPdfMenu" "ExtendedSubCommandsKey" "SpeedPdf.ImageMenu"

  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\01_ToPdf" "MUIVerb" "Convertir a PDF automaticamente"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\01_ToPdf" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\01_ToPdf" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\01_ToPdf\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\02_BatchSingle" "MUIVerb" "Unir imagenes en un solo PDF"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\02_BatchSingle" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\02_BatchSingle" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\02_BatchSingle\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-single-pdf --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\03_BatchSeparate" "MUIVerb" "Convertir cada imagen en un PDF por separado"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\03_BatchSeparate" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\03_BatchSeparate" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\03_BatchSeparate\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\04_Custom" "MUIVerb" "Configurar pagina y margenes..."
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\04_Custom" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\04_Custom" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.ImageMenu\shell\04_Custom\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=img-to-pdf --ui=custom --input="%1"'

  ; 4. Submenú cascada para selección múltiple mixta (.pdf + .docx + imágenes)
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchMenu" "MUIVerb" "SPEED.PDF (Lote mixto)"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchMenu" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchMenu" "AppliesTo" 'System.FileExtension:=".pdf" OR System.FileExtension:=".docx" OR System.FileExtension:=".jpg" OR System.FileExtension:=".jpeg" OR System.FileExtension:=".png" OR System.FileExtension:=".webp"'
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchMenu" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchMenu" "ExtendedSubCommandsKey" "SpeedPdf.BatchMenu"

  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\01_BatchSingle" "MUIVerb" "Convertir todos en un solo PDF"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\01_BatchSingle" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\01_BatchSingle" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\01_BatchSingle\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-single-pdf --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\02_BatchSeparate" "MUIVerb" "Convertir cada archivo en un PDF por separado"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\02_BatchSeparate" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\02_BatchSeparate" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\02_BatchSeparate\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-separate-pdfs --auto-convert --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\03_OpenBatch" "MUIVerb" "Abrir lote en SPEED.PDF..."
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\03_OpenBatch" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\03_OpenBatch" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SpeedPdf.BatchMenu\shell\03_OpenBatch\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-single-pdf --ui=custom --input="%1"'
!macroend

!macro customUnInstall
  SetShellVarContext all
  Delete "$SMPROGRAMS\SPEED.PDF\SPEED.PDF.lnk"
  Delete "$SMPROGRAMS\SPEED.PDF\Desinstalar SPEED.PDF.lnk"
  RMDir "$SMPROGRAMS\SPEED.PDF"
  SetShellVarContext current

  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMenu"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfMenu"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfMenu"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfMenu"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfMenu"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webp\shell\SpeedPdfMenu"
  DeleteRegKey HKCU "Software\Classes\*\shell\SpeedPdfBatchMenu"
  DeleteRegKey HKCU "Software\Classes\SpeedPdf.PdfMenu"
  DeleteRegKey HKCU "Software\Classes\SpeedPdf.DocxMenu"
  DeleteRegKey HKCU "Software\Classes\SpeedPdf.ImageMenu"
  DeleteRegKey HKCU "Software\Classes\SpeedPdf.BatchMenu"
  ; Limpieza heredada
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfAutoConvert"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfCompressCustom"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMerge"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfToWord"
  DeleteRegKey HKCU "Software\Classes\*\shell\SpeedPdfBatchSingle"
  DeleteRegKey HKCU "Software\Classes\*\shell\SpeedPdfBatchSeparate"
!macroend
