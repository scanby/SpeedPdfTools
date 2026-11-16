!macro customInstall
  ; Entradas contextuales en Explorador de Windows (HKCU, compatible Win 7-11 sin UAC)
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfAutoConvert" "" "SPEED.PDF: Convertir a PDF automaticamente"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfAutoConvert" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfAutoConvert" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.docx\shell\SpeedPdfAutoConvert\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfAutoConvert" "" "SPEED.PDF: Convertir a PDF automaticamente"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfAutoConvert" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfAutoConvert" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\SpeedPdfAutoConvert\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfAutoConvert" "" "SPEED.PDF: Convertir a PDF automaticamente"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfAutoConvert" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfAutoConvert" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\SpeedPdfAutoConvert\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfAutoConvert" "" "SPEED.PDF: Convertir a PDF automaticamente"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfAutoConvert" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfAutoConvert" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.png\shell\SpeedPdfAutoConvert\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfCompressCustom" "" "SPEED.PDF: Comprimir con ajustes personalizados..."
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfCompressCustom" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfCompressCustom" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfCompressCustom\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=compress --ui=custom --input="%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMerge" "" "SPEED.PDF: Unir archivos seleccionados"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMerge" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMerge" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfMerge\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=merge --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfToWord" "" "SPEED.PDF: Convertir a Word (.docx)"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfToWord" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\SpeedPdfToWord\command" "" '"$INSTDIR\SPEED.PDF.exe" --auto-convert --format=docx --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSingle" "" "SPEED.PDF: Convertir todos en un solo PDF"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSingle" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSingle" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSingle\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-single-pdf --output-dir=source --input="%1"'

  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSeparate" "" "SPEED.PDF: Convertir cada archivo en un PDF por separado"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSeparate" "Icon" "$INSTDIR\SPEED.PDF.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSeparate" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\SpeedPdfBatchSeparate\command" "" '"$INSTDIR\SPEED.PDF.exe" --mode=batch-separate-pdfs --output-dir=source --input="%1"'
!macroend

!macro customUnInstall
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
