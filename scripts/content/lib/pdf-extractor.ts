import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface ExtractedPdfPage {
  pageNumber: number
  text: string
}

export interface ExtractedPdf {
  totalPages: number
  pages: ExtractedPdfPage[]
  truncated: boolean
}

/** Parses an already validated PDF buffer. It never renders pages and performs no OCR. */
export async function extractPdfText(data: Uint8Array, maxPages: number): Promise<ExtractedPdf> {
  const task = getDocument({data, useSystemFonts: true})
  try {
    const document = await task.promise
    const count = Math.min(document.numPages, maxPages)
    const pages: ExtractedPdfPage[] = []
    for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items
        .flatMap((item) => ('str' in item && typeof item.str === 'string' ? [`${item.str}${item.hasEOL ? '\n' : ' '}`] : []))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim()
      pages.push({pageNumber, text})
      page.cleanup()
    }
    return {totalPages: document.numPages, pages, truncated: document.numPages > maxPages}
  } finally {
    await task.destroy()
  }
}
