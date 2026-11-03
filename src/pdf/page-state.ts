import { cloneLayers, DocumentHistory, type EditorDocument } from '../editor/model'
import { defaultWatermark } from '../watermark/render'

export interface PdfPageState {
  document: EditorDocument
  history: DocumentHistory
  saved: boolean
}

export function copyPageDocument(document: EditorDocument): EditorDocument {
  return { layers: cloneLayers(document.layers), watermark: { ...document.watermark } }
}

/** Keep editable page data and undo stacks, never a document's rendered images. */
export class PdfPageStates {
  private pages = new Map<number, PdfPageState>()

  get(page: number): PdfPageState {
    let state = this.pages.get(page)
    if (!state) {
      const document = { layers: [], watermark: defaultWatermark() }
      state = { document, history: new DocumentHistory(document), saved: false }
      this.pages.set(page, state)
    }
    return state
  }

  store(page: number, state: PdfPageState) {
    this.pages.set(page, { ...state, document: copyPageDocument(state.document) })
  }

  markSaved(pages: number[]) {
    for (const page of pages) this.get(page).saved = true
  }
}
