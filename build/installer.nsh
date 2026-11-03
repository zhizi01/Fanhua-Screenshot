; Installation never opts the user into Explorer integration. The settings
; window owns new HKCU registration; only legacy auto-registration is cleaned.
!macro FanhuaRemoveLegacyImageVerb ROOT EXT
  ReadRegStr $R0 ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --edit-image "%1"'
    ReadRegStr $R1 ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit" "FanhuaOptIn"
    ${If} $R1 != "1"
      DeleteRegKey ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit"
    ${EndIf}
  ${EndIf}
!macroend

!macro FanhuaUnregisterImageVerb ROOT EXT
  ; Keep a newer installation's registration even when an older one is removed.
  ReadRegStr $R0 ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit\command" ""
  ${If} $R0 == '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --edit-image "%1"'
    DeleteRegKey ${ROOT} "Software\Classes\SystemFileAssociations\.${EXT}\shell\FanhuaScreenshot.Edit"
  ${EndIf}
!macroend

!macro FanhuaCleanLegacyScope ROOT
  !insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "png"
  !insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "jpg"
  !insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "jpeg"
  !insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "webp"
  !insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "bmp"
  !insertmacro FanhuaRemoveLegacyImageVerb ${ROOT} "pdf"
!macroend

!macro FanhuaUnregisterScope ROOT
  !insertmacro FanhuaUnregisterImageVerb ${ROOT} "png"
  !insertmacro FanhuaUnregisterImageVerb ${ROOT} "jpg"
  !insertmacro FanhuaUnregisterImageVerb ${ROOT} "jpeg"
  !insertmacro FanhuaUnregisterImageVerb ${ROOT} "webp"
  !insertmacro FanhuaUnregisterImageVerb ${ROOT} "bmp"
  !insertmacro FanhuaUnregisterImageVerb ${ROOT} "pdf"
!macroend

!macro customInstall
  ; SHCTX follows the current/all-user installation mode, so an all-user update
  ; can remove the legacy HKLM verb. HKCU also covers this account's old install.
  !insertmacro FanhuaCleanLegacyScope SHCTX
  !insertmacro FanhuaCleanLegacyScope HKCU
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ${If} ${isUpdated}
    ; During an update keep the user's explicit opt-in, but retire old versions'
    ; automatic registrations. A genuine uninstall removes this installation's verb.
    !insertmacro FanhuaCleanLegacyScope SHCTX
    !insertmacro FanhuaCleanLegacyScope HKCU
  ${Else}
    !insertmacro FanhuaUnregisterScope SHCTX
    !insertmacro FanhuaUnregisterScope HKCU
  ${EndIf}
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
