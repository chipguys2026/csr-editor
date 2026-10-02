import { renderRegisterPdf } from './csr-pdf.js'

self.onmessage = async ({ data }) => {
  try {
    const result = await renderRegisterPdf(data.doc, data.dataWidth, {
      date: new Date(data.date),
    })
    self.postMessage(result)
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
