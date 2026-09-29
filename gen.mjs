// Headless driver for the csr-editor RTL generator.
//
//   node gen.mjs <map.json> <output-dir>
//
// The editor is a browser app; this is the same generator called from a
// script so the RTL can be regenerated in a build without opening a UI.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateRtlFiles } from './src/lib/csr-rtl.js'
import { generateSdcFiles } from './src/lib/csr-sdc.js'
import { PDF_FONTS, buildPdfDefinition } from './src/lib/csr-pdf.js'
import pdfmake from 'pdfmake'

const [, , src, outDir] = process.argv
if (!src || !outDir) {
  console.error('usage: node gen.mjs <map.json> <output-dir>')
  process.exit(2)
}

const doc = JSON.parse(readFileSync(src, 'utf8'))
//  The SDC carries the timing exceptions for the fields marked quasi-static.
//  It is generated from the same document, so a field ticked in the editor
//  cannot be forgotten here.
for (const f of [...generateRtlFiles(doc), ...generateSdcFiles(doc)]) {
  const path = join(outDir, f.name)
  writeFileSync(path, f.content)
  console.log(`${path}  (${f.content.split('\n').length} lines)`)
}

//  The register datasheet, the same file the editor's Download PDF produces.
//  Standard fonts only, so nothing is read from disk or the network.
pdfmake.setFonts(PDF_FONTS)
pdfmake.setUrlAccessPolicy(() => false)
const standardFonts = new Set(
  Object.values(PDF_FONTS).flatMap((family) => Object.values(family))
)
pdfmake.setLocalAccessPolicy((path) => standardFonts.has(path))

const pdfPath = join(outDir, `${doc.params?.moduleName ?? 'CSR'}_registers.pdf`)
const pdf = pdfmake.createPdf(buildPdfDefinition(doc.params, doc.registers))
await pdf.write(pdfPath)
console.log(pdfPath)
