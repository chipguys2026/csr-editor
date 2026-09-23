import { accessFillOf } from './access-types.js'
import { buildDocument } from './csr-document.js'
import { normalizeRegister } from './register.js'

/**
 * The register datasheet as a pdfmake document definition: the same model the
 * document page renders, laid out for paper. Pure data, so the browser and the
 * headless generator build the identical file; only the rendering differs.
 *
 * Fonts are the PDF standard ones (Helvetica, Courier), which every reader
 * already has, so the file embeds no font and stays small.
 */

const MAP_ID = 'register-map'

const escapeXml = (text) =>
  String(text).replace(
    /[<>&"']/g,
    (ch) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[ch]
  )

/**
 * The bit diagram, drawn the way the editor draws it: the register as a row of
 * bit cells, MSB on the left, each field's boundary bits numbered above and its
 * name hung off a leader line to the right. In points, sized to the page.
 */
export const registerDiagramSvg = (fields, dataWidth, width = 515) => {
  const pad = 2
  const indexRow = 12
  const barHeight = 22
  const firstGap = 14
  const gap = 11
  const fontSize = 7

  const named = [...fields].sort((a, b) => a.bitRange.lsb - b.bitRange.lsb)
  const nameWidth = Math.max(
    0,
    ...named.map((field) => field.name.length * fontSize * 0.6)
  )
  // The bar takes what the names leave, and no more than the page gives.
  const barWidth = Math.min(width - nameWidth - pad * 2 - 6, 400)
  const cell = barWidth / dataWidth
  const barTop = pad + indexRow
  const height = barTop + barHeight + firstGap + named.length * gap + pad

  const bitX = (bit) => pad + (dataWidth - 1 - bit) * cell
  const parts = []

  const spans = normalizeRegister(fields, dataWidth)

  for (const span of spans) {
    const { msb, lsb } = span.bitRange
    const fill = accessFillOf(span.type, span.name === 'RESERVED')

    parts.push(
      `<rect x="${bitX(msb)}" y="${barTop}" width="${(msb - lsb + 1) * cell}" height="${barHeight}" fill="${fill}"/>`
    )
  }

  // A tick per bit, top and bottom, so a width can be counted off the page.
  for (let bit = 1; bit < dataWidth; bit += 1) {
    const x = pad + bit * cell
    parts.push(
      `<line x1="${x}" y1="${barTop}" x2="${x}" y2="${barTop + 3}" stroke="#404040" stroke-width="0.4"/>`,
      `<line x1="${x}" y1="${barTop + barHeight - 3}" x2="${x}" y2="${barTop + barHeight}" stroke="#404040" stroke-width="0.4"/>`
    )
  }

  // Field boundaries full height, and the boundary bits numbered above them.
  const numbered = new Set()
  for (const span of spans) {
    const { msb, lsb } = span.bitRange

    if (msb !== dataWidth - 1) {
      const x = bitX(msb)
      parts.push(
        `<line x1="${x}" y1="${barTop}" x2="${x}" y2="${barTop + barHeight}" stroke="#171717" stroke-width="0.8"/>`
      )
    }

    for (const bit of [msb, lsb]) {
      if (numbered.has(bit)) continue
      numbered.add(bit)
      parts.push(
        `<text x="${bitX(bit) + cell / 2}" y="${barTop - 3}" font-size="${fontSize}" font-family="Courier" text-anchor="middle">${bit}</text>`
      )
    }
  }

  parts.push(
    `<rect x="${pad}" y="${barTop}" width="${barWidth}" height="${barHeight}" fill="none" stroke="#171717" stroke-width="0.8"/>`
  )

  // Rows follow bit position, so no leader crosses another.
  named.forEach((field, row) => {
    const { msb, lsb } = field.bitRange
    const x = (bitX(msb) + bitX(lsb) + cell) / 2
    const y = barTop + barHeight + firstGap + row * gap
    const end = pad + barWidth + 2

    parts.push(
      `<polyline points="${x},${barTop + barHeight} ${x},${y} ${end},${y}" fill="none" stroke="#404040" stroke-width="0.6"/>`,
      `<text x="${end + 2}" y="${y + fontSize / 2 - 1}" font-size="${fontSize + 1}" font-family="Courier">${escapeXml(field.name)}</text>`
    )
  })

  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join('')}</svg>`,
    width,
    height,
  }
}

const th = (text) => ({ text, style: 'th' })

const tableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => '#a3a3a3',
  vLineColor: () => '#a3a3a3',
  fillColor: (row, node) =>
    row < (node.table.headerRows ?? 0) ? '#f0f0f0' : null,
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
}

const fieldDescription = (row) => {
  if (row.reserved) return { text: 'Reserved', color: '#737373' }

  return {
    stack: [
      ...(row.description ? [{ text: row.description }] : []),
      ...row.notes.map((note) => ({
        text: note,
        italics: true,
        color: '#525252',
      })),
      ...row.enumValues.map((entry) => ({
        text: [
          { text: entry.label, font: 'Courier' },
          ' = ',
          { text: entry.name, font: 'Courier', bold: true },
          entry.description ? ` - ${entry.description}` : '',
        ],
      })),
    ],
  }
}

const registerSection = (reg, dataWidth) => {
  const diagram = registerDiagramSvg(reg.diagramFields, dataWidth)
  const mono = (text, extra = {}) => ({ text, font: 'Courier', ...extra })

  return [
    {
      // Heading, prose and diagram as one unbreakable block: a page that ends
      // on a register name with its bits overleaf reads as a missing register.
      unbreakable: true,
      stack: [
        {
          id: reg.id,
          text: reg.name,
          style: 'h3',
          // A bookmark under Registers, so the reader's sidebar lists them.
          outline: true,
          outlineParentId: 'registers',
        },
        {
          columns: [
            mono(`${reg.address}${reg.range ? ` (${reg.range})` : ''}`, {
              color: '#525252',
            }),
            mono(`Reset ${reg.resetValue}`, {
              color: '#525252',
              alignment: 'right',
            }),
          ],
          fontSize: 9,
          margin: [0, 0, 0, 4],
        },
        {
          canvas: [
            {
              type: 'line',
              x1: 0,
              y1: 0,
              x2: 515,
              y2: 0,
              lineWidth: 0.5,
              lineColor: '#a3a3a3',
            },
          ],
          margin: [0, 0, 0, 6],
        },
        ...(reg.description
          ? [{ text: reg.description, margin: [0, 0, 0, 6] }]
          : []),
        {
          svg: diagram.svg,
          width: diagram.width,
          font: 'Courier',
          margin: [0, 0, 0, 6],
        },
      ],
    },
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [48, 90, 36, 44, '*'],
        body: [
          [
            th('Bits'),
            th('Field'),
            th('Access'),
            th('Reset'),
            th('Description'),
          ],
          ...reg.rows.map((row) => {
            const color = row.reserved ? '#737373' : undefined
            return [
              mono(row.bits, { color }),
              mono(row.name, { color }),
              mono(row.access, { color }),
              mono(row.reset, { color }),
              fieldDescription(row),
            ]
          }),
        ],
      },
      layout: tableLayout,
      fontSize: 8,
    },
    {
      text: 'Back to register map',
      linkToDestination: MAP_ID,
      color: '#2563eb',
      fontSize: 8,
      margin: [0, 4, 0, 18],
    },
  ]
}

/**
 * The pdfmake document definition for a register map.
 * @param {object} params - Document parameters
 * @param {object} registers - Register map, keyed by address
 * @param {object} [options]
 * @param {Date} [options.date] - Generation date printed on the cover
 */
export const buildPdfDefinition = (
  params = {},
  registers = {},
  options = {}
) => {
  const doc = buildDocument(params, registers)
  const dataWidth = Number(params.dataWidth ?? 32)
  const date = (options.date ?? new Date()).toISOString().slice(0, 10)
  const mono = (text) => ({ text, font: 'Courier' })

  const heading = (text, id) => ({
    text,
    id,
    style: 'h2',
    outline: true,
  })

  const content = [
    { text: `${doc.title} Register Specification`, style: 'h1' },
    {
      text: `Generated ${date} by csr-editor`,
      color: '#737373',
      margin: [0, 0, 0, 12],
    },
    {
      table: {
        widths: [90, 'auto'],
        body: doc.summary.map(([label, value]) => [th(label), mono(value)]),
      },
      layout: {
        ...tableLayout,
        fillColor: (_row, _node, col) => (col === 0 ? '#f0f0f0' : null),
      },
      margin: [0, 0, 0, 16],
    },
  ]

  if (doc.parameters.length > 0) {
    content.push(heading('Parameters', 'parameters'), {
      table: {
        headerRows: 1,
        widths: ['auto', 'auto'],
        body: [
          [th('Name'), th('Default')],
          ...doc.parameters.map((entry) => [
            mono(entry.name),
            mono(entry.value),
          ]),
        ],
      },
      layout: tableLayout,
      margin: [0, 0, 0, 16],
    })
  }

  if (doc.accessTypes.length > 0) {
    content.push(heading('Access Types', 'access-types'), {
      table: {
        widths: [40, '*'],
        body: doc.accessTypes.map((entry) => [
          {
            text: entry.type,
            font: 'Courier',
            bold: true,
            fillColor: accessFillOf(entry.type),
          },
          entry.description,
        ]),
      },
      layout: tableLayout,
      margin: [0, 0, 0, 16],
    })
  }

  content.push(heading('Register Map', MAP_ID))

  if (doc.registers.length === 0) {
    content.push({ text: 'No registers defined.', color: '#737373' })
  } else {
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        // Sized to what they hold; the description takes the rest of the line.
        widths: ['auto', 'auto', 'auto', '*', 'auto'],
        body: [
          [
            th('Address'),
            th('Register'),
            th('Reset'),
            th('Description'),
            th('Page'),
          ],
          ...doc.registers.map((reg) => [
            {
              stack: [
                mono(reg.address),
                ...(reg.range
                  ? [
                      {
                        text: reg.range,
                        font: 'Courier',
                        fontSize: 7,
                        color: '#737373',
                      },
                    ]
                  : []),
              ],
            },
            {
              text: reg.name,
              font: 'Courier',
              color: '#2563eb',
              linkToDestination: reg.id,
            },
            mono(reg.resetValue),
            // First line only: the full text is in the register's own section.
            reg.description.split('\n')[0],
            {
              pageReference: reg.id,
              linkToDestination: reg.id,
              alignment: 'right',
            },
          ]),
        ],
      },
      layout: tableLayout,
      fontSize: 8,
    })

    content.push(
      { text: '', pageBreak: 'after' },
      { ...heading('Registers', 'registers'), outlineExpanded: true },
      ...doc.registers.flatMap((reg) => registerSection(reg, dataWidth))
    )
  }

  return {
    info: {
      title: `${doc.title} Register Specification`,
      creator: 'csr-editor',
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 44],
    content,
    footer: (page, pages) => ({
      columns: [
        { text: `${doc.title} Register Specification`, color: '#737373' },
        { text: `${page} / ${pages}`, alignment: 'right', color: '#737373' },
      ],
      fontSize: 8,
      margin: [40, 14, 40, 0],
    }),
    defaultStyle: { font: 'Helvetica', fontSize: 9, lineHeight: 1.15 },
    styles: {
      h1: { fontSize: 20, bold: true, margin: [0, 0, 0, 4] },
      h2: { fontSize: 14, bold: true, margin: [0, 8, 0, 6] },
      h3: { fontSize: 12, bold: true, font: 'Courier', margin: [0, 0, 0, 2] },
      th: { bold: true, fontSize: 8 },
    },
  }
}

/** Fonts the definition uses: the PDF standard families, nothing embedded. */
export const PDF_FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
  Courier: {
    normal: 'Courier',
    bold: 'Courier-Bold',
    italics: 'Courier-Oblique',
    bolditalics: 'Courier-BoldOblique',
  },
}
