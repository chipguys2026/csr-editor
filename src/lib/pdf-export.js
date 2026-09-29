import { buildPdfDefinition } from './csr-pdf'

/**
 * pdfmake is loaded on the first export rather than with the app: it is most
 * of a megabyte, and most sessions never make a PDF.
 */
let pdfMakeLoading = null

const loadPdfMake = () => {
  pdfMakeLoading ??= Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/standard-fonts/Helvetica'),
    import('pdfmake/build/standard-fonts/Courier'),
  ]).then(([pdfMake, helvetica, courier]) => {
    const instance = pdfMake.default ?? pdfMake

    // The standard fonts are metrics only - the reader supplies the glyphs -
    // so nothing is embedded and the file stays small.
    instance.addFontContainer(helvetica.default ?? helvetica)
    instance.addFontContainer(courier.default ?? courier)

    return instance
  })

  // A failed load is retried on the next export rather than cached.
  pdfMakeLoading.catch(() => {
    pdfMakeLoading = null
  })

  return pdfMakeLoading
}

/**
 * Build the register datasheet and download it as <module>_registers.pdf.
 * @param {object} params - Document parameters
 * @param {object} registers - Register map, keyed by address
 * @returns {Promise<string>} the file name downloaded
 */
export const exportRegisterPdf = async (params, registers) => {
  const pdfMake = await loadPdfMake()
  const filename = `${params.moduleName ?? 'CSR'}_registers.pdf`

  await pdfMake
    .createPdf(buildPdfDefinition(params, registers))
    .download(filename)

  return filename
}
