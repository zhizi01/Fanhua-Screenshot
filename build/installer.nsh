; Follow NSIS current/all ShellVarContext, including elevated all-user installs.
; Do not replace image defaults or another app's keys.
!macro FanhuaRegisterImageVerb EXT
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit" "" "使用繁花有图编辑"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit" "MultiSelectModel" "Single"
  WriteRegStr SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --edit-image "%1"'
!macroend

!macro FanhuaUnregisterImageVerb EXT
  ; An older installation must not remove a newer installation's registration.
  ReadRegStr $R0 SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit\command" ""
  StrCmp $R0 '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --edit-image "%1"' 0 +2
    DeleteRegKey SHCTX "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit"
!macroend

!macro customInstall
  !insertmacro FanhuaRegisterImageVerb "png"
  !insertmacro FanhuaRegisterImageVerb "jpg"
  !insertmacro FanhuaRegisterImageVerb "jpeg"
  !insertmacro FanhuaRegisterImageVerb "webp"
  !insertmacro FanhuaRegisterImageVerb "bmp"
  !insertmacro FanhuaRegisterImageVerb "pdf"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  !insertmacro FanhuaUnregisterImageVerb "png"
  !insertmacro FanhuaUnregisterImageVerb "jpg"
  !insertmacro FanhuaUnregisterImageVerb "jpeg"
  !insertmacro FanhuaUnregisterImageVerb "webp"
  !insertmacro FanhuaUnregisterImageVerb "bmp"
  !insertmacro FanhuaUnregisterImageVerb "pdf"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
