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
