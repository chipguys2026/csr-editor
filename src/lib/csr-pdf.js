// Generated output permission: see OUTPUT-EXCEPTION.md at the project root.
import { createElement as h } from 'react'
import {
  Document,
  Page,
  View,
  Text,
  Link,
  Svg,
  Rect,
  Line,
  Polyline,
  pdf,
} from '@react-pdf/renderer'
import { normalizeRegister } from './register.js'
import { accessPdfStyleOf, tw } from './pdf-styles.js'

// React elements without JSX keep the document usable by the native Node CLI.
const PAGE_WIDTH = 515.28
const MAP_ID = 'register-map'
const mono = tw('font-mono')
const muted = tw('text-neutral-500')
const link = tw('text-blue-600 no-underline')
const pageStyle = {
  ...tw('font-sans text-neutral-900'),
  padding: 40,
  paddingTop: 72,
  paddingBottom: 52,
  fontSize: 9,
}

const Header = ({ title }) =>
  h(Text, {
    fixed: true,
    style: {
      ...muted,
      position: 'absolute',
      top: 28,
      left: 40,
      right: 40,
      fontSize: 8,
      borderBottomWidth: 0.5,
      borderColor: tw('border-neutral-400').borderColor,
      paddingBottom: 6,
    },
    children: `${title} Register Specification`,
  })

const Footer = ({ date }) =>
  h(
    View,
    {
      fixed: true,
      style: {
        ...tw('flex-row justify-between text-neutral-500'),
        position: 'absolute',
        bottom: 22,
        left: 40,
        right: 40,
        fontSize: 8,
      },
    },
    h(
      Text,
      { style: { maxWidth: 440 } },
      `Generated ${date} by CSR Editor from ChipGuys`
    ),
    h(Text, {
      render: ({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`,
    })
  )

const Heading = ({ id, children, onPage, level = 2 }) =>
  h(Text, {
    id,
    bookmark: String(children),
    minPresenceAhead: 24,
    style: {
      ...tw('font-bold'),
      fontSize: level === 1 ? 20 : 14,
      marginTop: level === 1 ? 0 : 12,
      marginBottom: 6,
    },
    render: ({ pageNumber }) => {
      onPage(id, pageNumber)
      return children
    },
  })

/** A table assembled from PDF primitives, with rows kept together when possible. */
const Table = ({
  headers,
  widths,
  rows,
  repeatHeader = false,
  allowRowWrap = false,
}) => {
  const cells = (values, header = false) =>
    values.map((value, column) =>
      h(
        View,
        {
          key: column,
          style: {
            borderRightWidth: column === widths.length - 1 ? 0 : 0.5,
            borderColor: tw('border-neutral-400').borderColor,
            paddingHorizontal: 4,
            paddingVertical: 3,
            minWidth: 0,
            ...(widths[column] === '*'
              ? { flexGrow: 1, flexBasis: 0 }
              : { width: widths[column], flexShrink: 0 }),
            ...(header ? tw('bg-neutral-100 font-bold') : {}),
          },
        },
        typeof value === 'string' || typeof value === 'number'
          ? h(Text, null, String(value))
          : value
      )
    )

  const rowStyle = {
    ...tw('flex-row'),
    borderBottomWidth: 0.5,
    borderColor: tw('border-neutral-400').borderColor,
  }
  return h(
    View,
    {
      style: {
        borderTopWidth: 0.5,
        borderLeftWidth: 0.5,
        borderRightWidth: 0.5,
        borderColor: tw('border-neutral-400').borderColor,
        fontSize: 8,
      },
    },
    headers &&
      h(
        View,
        {
          fixed: repeatHeader,
          wrap: false,
          minPresenceAhead: 18,
          style: rowStyle,
        },
        ...cells(headers, true)
      ),
    ...rows.map((values, index) =>
      h(
        View,
        {
          key: index,
          wrap: allowRowWrap,
          minPresenceAhead: 18,
          style: rowStyle,
        },
        ...cells(values)
      )
    )
  )
}

/** Vector diagram: bit positions, reserved gaps, field boundaries and leaders. */
const RegisterDiagram = ({ fields, dataWidth }) => {
  const pad = 2
  const fontSize = 7
  const named = [...fields].sort((a, b) => a.bitRange.lsb - b.bitRange.lsb)
  const maxNameWidth = Math.max(
    0,
    ...named.map((field) => field.name.length * fontSize * 0.6)
  )
  // Scale long labels with the diagram instead of allowing a negative bar width.
  const width = Math.max(PAGE_WIDTH, maxNameWidth + 180)
  const barWidth = Math.min(width - maxNameWidth - pad * 2 - 6, 400)
  const cell = barWidth / dataWidth
  const barTop = 14
  const barHeight = 22
  const height = barTop + barHeight + 14 + named.length * 11 + pad
  const bitX = (bit) => pad + (dataWidth - 1 - bit) * cell
  const spans = normalizeRegister(fields, dataWidth)
  const stroke = tw('text-neutral-700').color
  const shapes = []
  const numbered = new Set()

  for (const span of spans) {
    const { msb, lsb } = span.bitRange
    shapes.push(
      h(Rect, {
        key: `fill-${lsb}`,
        x: bitX(msb),
        y: barTop,
        width: (msb - lsb + 1) * cell,
        height: barHeight,
        fill: accessPdfStyleOf(span.type, span.name === 'RESERVED')
          .backgroundColor,
      })
    )
    if (msb !== dataWidth - 1)
      shapes.push(
        h(Line, {
          key: `boundary-${lsb}`,
          x1: bitX(msb),
          x2: bitX(msb),
          y1: barTop,
          y2: barTop + barHeight,
          stroke,
          strokeWidth: 0.8,
        })
      )
    for (const bit of [msb, lsb]) {
      if (numbered.has(bit)) continue
      numbered.add(bit)
      shapes.push(
        h(
          Text,
          {
            key: `bit-${bit}`,
            x: bitX(bit) + cell / 2,
            y: barTop - 3,
            fontFamily: 'Courier',
            fontSize,
            textAnchor: 'middle',
          },
          String(bit)
        )
      )
    }
  }
  for (let bit = 1; bit < dataWidth; bit += 1) {
    const x = pad + bit * cell
    shapes.push(
      h(Line, {
        key: `top-${bit}`,
        x1: x,
        x2: x,
        y1: barTop,
        y2: barTop + 3,
        stroke,
        strokeWidth: 0.4,
      })
    )
    shapes.push(
      h(Line, {
        key: `bottom-${bit}`,
        x1: x,
        x2: x,
        y1: barTop + barHeight - 3,
        y2: barTop + barHeight,
        stroke,
        strokeWidth: 0.4,
      })
    )
  }
  shapes.push(
    h(Rect, {
      key: 'frame',
      x: pad,
      y: barTop,
      width: barWidth,
      height: barHeight,
      fill: 'none',
      stroke,
      strokeWidth: 0.8,
    })
  )
  named.forEach((field, row) => {
    const { msb, lsb } = field.bitRange
    const x = (bitX(msb) + bitX(lsb) + cell) / 2
    const y = barTop + barHeight + 14 + row * 11
    const end = pad + barWidth + 2
    shapes.push(
      h(Polyline, {
        key: `leader-${lsb}`,
        points: `${x},${barTop + barHeight} ${x},${y} ${end},${y}`,
        fill: 'none',
        stroke,
        strokeWidth: 0.6,
      })
    )
    shapes.push(
      h(
        Text,
        {
          key: `name-${lsb}`,
          x: end + 2,
          y: y + fontSize / 2 - 1,
          fontSize: fontSize + 1,
          fontFamily: 'Courier',
        },
        field.name
      )
    )
  })
  const scale = Math.min(PAGE_WIDTH / width, 580 / height, 1)
  return h(
    Svg,
    {
      width: width * scale,
      height: height * scale,
      viewBox: `0 0 ${width} ${height}`,
      style: { marginBottom: 8 },
    },
    ...shapes
  )
}

const FieldDescription = ({ row }) =>
  row.reserved
    ? h(Text, { style: muted }, 'Reserved')
    : h(
        View,
        null,
        row.description && h(Text, null, row.description),
        ...row.notes.map((note, i) =>
          h(
            Text,
            { key: `note-${i}`, style: { ...muted, fontStyle: 'italic' } },
            note
          )
        ),
        ...row.enumValues.map((entry, i) =>
          h(
            Text,
            { key: `enum-${i}` },
            h(Text, { style: mono }, `${entry.label} = `),
            h(Text, { style: { ...mono, fontWeight: 'bold' } }, entry.name),
            entry.description ? ` - ${entry.description}` : ''
          )
        )
      )

const RegisterPage = ({ reg, title, date, dataWidth, onPage }) =>
  h(
    Page,
    {
      size: 'A4',
      style: { ...pageStyle, paddingTop: 118 },
      bookmark: { title: reg.name, fit: true },
    },
    h(Header, { title }),
    h(
      View,
      {
        fixed: true,
        style: {
          position: 'absolute',
          top: 64,
          left: 40,
          right: 40,
          borderBottomWidth: 0.5,
          borderColor: tw('border-neutral-400').borderColor,
          paddingBottom: 6,
        },
      },
      h(
        Text,
        { style: { ...mono, fontSize: 12, fontWeight: 'bold' } },
        reg.name
      ),
      h(
        View,
        { style: tw('flex-row justify-between') },
        h(
          Text,
          { style: { ...mono, ...muted, maxWidth: 370, fontSize: 8 } },
          `${reg.address}${reg.range ? ` (${reg.range})` : ''}`
        ),
        h(
          Text,
          { style: { ...mono, ...muted, fontSize: 8 } },
          `Reset ${reg.resetValue}`
        )
      )
    ),
    // A single non-fixed destination keeps links on the first page even when
    // the register heading is repeated on continuation pages.
    h(Text, {
      id: reg.id,
      style: {
        position: 'absolute',
        top: 64,
        left: 40,
        fontSize: 1,
        height: 1,
      },
      render: ({ pageNumber }) => {
        onPage(reg.id, pageNumber)
        return ' '
      },
    }),
    reg.description && h(Text, { style: { marginBottom: 8 } }, reg.description),
    h(RegisterDiagram, { fields: reg.diagramFields, dataWidth }),
    h(Table, {
      headers: ['Bits', 'Field', 'Access', 'Reset', 'Description'],
      widths: [48, 90, 44, 50, '*'],
      repeatHeader: true,
      allowRowWrap: true,
      rows: reg.rows.map((row) => [
        h(Text, { style: [mono, row.reserved && muted] }, row.bits),
        h(Text, { style: [mono, row.reserved && muted] }, row.name),
        h(Text, { style: [mono, row.reserved && muted] }, row.access),
        h(Text, { style: [mono, row.reserved && muted] }, row.reset),
        h(FieldDescription, { row }),
      ]),
    }),
    h(
      Link,
      { src: `#${MAP_ID}`, style: { ...link, fontSize: 8, marginTop: 6 } },
      'Back to register map'
    ),
    h(Footer, { date })
  )

/** The exact document used by the browser preview, download, and Node CLI. */
export const RegisterPdfDocument = ({
  doc,
  dataWidth,
  date,
  pageNumbers = {},
  onPage = () => {},
}) =>
  h(
    Document,
    {
      title: `${doc.title} Register Specification`,
      creator: 'CSR Editor from ChipGuys',
    },
    h(
      Page,
      { size: 'A4', style: pageStyle },
      h(Header, { title: doc.title }),
      h(
        Heading,
        { id: 'overview', level: 1, onPage },
        `${doc.title} Register Specification`
      ),
      h(Table, {
        widths: [110, '*'],
        rows: doc.summary.map(([label, value]) => [
          h(Text, { style: tw('font-bold') }, label),
          h(Text, { style: mono }, value),
        ]),
      }),
      doc.parameters.length > 0 &&
        h(
          View,
          null,
          h(Heading, { id: 'parameters', onPage }, 'Parameters'),
          h(Table, {
            headers: ['Name', 'Default'],
            widths: [160, '*'],
            rows: doc.parameters.map((entry) => [
              h(Text, { style: mono }, entry.name),
              h(Text, { style: mono }, entry.value),
            ]),
          })
        ),
      h(Heading, { id: 'access-types', onPage }, 'Access Types'),
      h(Table, {
        widths: [48, '*'],
        rows: doc.accessTypes.map((entry) => [
          h(
            Text,
            {
              style: {
                ...mono,
                ...tw('font-bold'),
                ...accessPdfStyleOf(entry.type),
                padding: 2,
              },
            },
            entry.type
          ),
          entry.description,
        ]),
      }),
      h(Heading, { id: MAP_ID, onPage }, 'Register Map'),
      doc.registers.length === 0
        ? h(Text, { style: muted }, 'No registers defined.')
        : h(Table, {
            headers: ['Address', 'Register', 'Reset', 'Description', 'Page'],
            widths: [95, 105, 75, '*', 28],
            rows: doc.registers.map((reg) => [
              h(
                View,
                null,
                h(Text, { style: mono }, reg.address),
                reg.range &&
                  h(Text, { style: { ...muted, fontSize: 7 } }, reg.range)
              ),
              h(
                Link,
                { src: `#${reg.id}`, style: { ...mono, ...link } },
                reg.name
              ),
              h(Text, { style: mono }, reg.resetValue),
              reg.description.split('\n')[0],
              h(
                Link,
                {
                  src: `#${reg.id}`,
                  style: { ...mono, ...link, textAlign: 'right' },
                },
                String(pageNumbers[reg.id] ?? '-')
              ),
            ]),
          }),
      h(Footer, { date })
    ),
    ...doc.registers.map((reg) =>
      h(RegisterPage, { key: reg.id, reg, title: doc.title, date, dataWidth, onPage })
    )
  )

/**
 * Resolve destination pages, then render the page-reference column. A bounded
 * extra pass covers a digit-width change that might affect pagination.
 */
export const renderRegisterPdf = async (doc, dataWidth, options = {}) => {
  const date = (options.date ?? new Date()).toISOString().slice(0, 10)
  let pageNumbers = {}
  for (let pass = 0; pass < 4; pass += 1) {
    const resolved = {}
    const element = h(RegisterPdfDocument, {
      doc,
      dataWidth,
      date,
      pageNumbers,
      onPage: (id, pageNumber) => {
        resolved[id] = pageNumber
      },
    })
    const blob = await pdf(element).toBlob()
    if (Object.keys(resolved).every((id) => resolved[id] === pageNumbers[id]))
      return { blob, pageNumbers: resolved }
    pageNumbers = resolved
  }
  throw new Error('PDF page references did not converge')
}
