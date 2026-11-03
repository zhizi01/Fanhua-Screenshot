/** 翻译入口预留；尚未配置提供方，也不会发起网络请求。 */
export interface TranslationRequest { text: string; sourceLanguage: string; targetLanguage: string }
export interface TranslationResult { text: string; sourceLanguage: string; targetLanguage: string }
export interface TranslationProvider {
  id: string
  translate(request: TranslationRequest): Promise<TranslationResult>
}
export const translationAvailable = false
