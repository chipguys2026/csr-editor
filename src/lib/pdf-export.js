/** Generate off the main thread so larger maps do not freeze the editor. */
const generateRegisterPdf = (doc, dataWidth, date, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('PDF generation cancelled', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./pdf-worker.js', import.meta.url), {
      type: 'module',
    })
    const finish = (callback, value) => {
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      callback(value)
    }
    const abort = () =>
      finish(reject, new DOMException('PDF generation cancelled', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    worker.onmessage = ({ data }) =>
      data.error ? finish(reject, new Error(data.error)) : finish(resolve, data)
    worker.onerror = (event) =>
      finish(reject, new Error(event.message || 'Failed to generate PDF'))
    worker.onmessageerror = () =>
      finish(reject, new Error('Failed to read generated PDF'))
    try {
      worker.postMessage({ doc, dataWidth, date })
    } catch (error) {
      finish(reject, error)
    }
  })

// Keep one PDF across route changes, including a generation already in progress.
let cachedPdf
const cacheKey = (doc, dataWidth, date = new Date().toISOString().slice(0, 10)) =>
  JSON.stringify([date, dataWidth, doc])

export const getCachedRegisterPdf = (doc, dataWidth) =>
  cachedPdf?.key === cacheKey(doc, dataWidth) ? cachedPdf.result : null

export const discardStaleRegisterPdf = (doc, dataWidth) => {
  if (!cachedPdf || cachedPdf.key === cacheKey(doc, dataWidth)) return
  cachedPdf.controller.abort()
  if (cachedPdf.result) URL.revokeObjectURL(cachedPdf.result.url)
  cachedPdf = undefined
}

export const createRegisterPdf = (doc, dataWidth, signal) => {
  if (signal?.aborted)
    return Promise.reject(new DOMException('PDF generation cancelled', 'AbortError'))

  const date = new Date().toISOString().slice(0, 10)
  const key = cacheKey(doc, dataWidth, date)
  if (cachedPdf?.key !== key) {
    cachedPdf?.controller.abort()
    if (cachedPdf?.result) URL.revokeObjectURL(cachedPdf.result.url)
    const entry = { key, controller: new AbortController() }
    cachedPdf = entry
    entry.promise = generateRegisterPdf(
      doc,
      dataWidth,
      date,
      entry.controller.signal
    )
      .then((generated) => {
        if (cachedPdf !== entry)
          throw new DOMException('PDF generation cancelled', 'AbortError')
        entry.result = { ...generated, url: URL.createObjectURL(generated.blob) }
        return entry.result
      })
      .catch((error) => {
        if (cachedPdf === entry) cachedPdf = undefined
        throw error
      })
  }

  // Leaving the page cancels its subscription, while the shared job can finish.
  const promise = cachedPdf.promise
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal?.removeEventListener('abort', abort)
      reject(new DOMException('PDF generation cancelled', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    promise.then(
      (result) => {
        signal?.removeEventListener('abort', abort)
        if (!signal?.aborted) resolve(result)
      },
      (error) => {
        signal?.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    cachedPdf?.controller.abort()
    if (cachedPdf?.result) URL.revokeObjectURL(cachedPdf.result.url)
  })
}

/** Download the already generated preview, so its contents match exactly. */
export const downloadRegisterPdf = (url, moduleName) => {
  const filename = `${moduleName ?? 'CSR'}_registers.pdf`
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  return filename
}
