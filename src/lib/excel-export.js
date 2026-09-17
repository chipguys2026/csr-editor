import * as XLSX from 'xlsx-js-style'

import {
  formatArrayAddress,
  formatArrayRange,
  formatBitRange,
  resolveWidth,
} from './register'
import { buildAddressMap } from './address-map'

/** The register header row plus one row per field, as the sheets present it. */
const registerBlock = (address, name, reg, params) => [
  {
    isRegisterRow: true,
    address,
    registerName: name,
    fieldName: '',
    bitRange: '',
    width: '',
    type: '',
    resetValue: '',
    description: reg?.description ?? '',
  },
  ...(reg?.fields ?? []).map((field) => ({
    isRegisterRow: false,
    address: '',
    registerName: '',
    fieldName: field.name,
    // A parameter-wide field documents the expression, e.g. [8 +: NUM_LANES].
    bitRange: formatBitRange(
      field.bitRange.msb,
      field.bitRange.lsb,
      field.bitRange.width
    ),
    width: field.bitRange.width ?? resolveWidth(field.bitRange, params.parameters),
    type: field.type,
    resetValue: `0x${field.resetValue.toString(16).toUpperCase()}`,
    description: field.desc,
  })),
]

/**
 * The same listing with every array expanded: `0x24 + 12·(L-1), L = 1..N-1`
 * becomes one block per instance at its own address, fields repeated, so the
 * sheet can be read straight down without resolving the expression by hand.
 */
export const flattenRegisters = (params, registers) => {
  const digits = Math.ceil((params.addrWidth ?? 16) / 4)
  const addr = (value) =>
    `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`

  return [...buildAddressMap(registers, params.parameters).entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([address, entries]) =>
      entries.flatMap((entry) =>
        registerBlock(
          addr(address),
          entry.index == null ? entry.name : `${entry.name}[${entry.index}]`,
          registers[entry.regAddr],
          params
        )
      )
    )
}


const REGISTER_HEADERS = [
  'Address',
  'Register Name',
  'Field Name',
  'Bit Range',
  'Width',
  'Type',
  'Reset Value',
  'Description',
]

const CELL_BORDER = {
  top: { style: 'thin', color: { rgb: '000000' } },
  bottom: { style: 'thin', color: { rgb: '000000' } },
  left: { style: 'thin', color: { rgb: '000000' } },
  right: { style: 'thin', color: { rgb: '000000' } },
}

/** Both register sheets are built here, so they cannot drift apart. */
const buildRegisterSheet = (rows) => {
  const data = [
    REGISTER_HEADERS,
    ...rows.map((row) => [
      row.address,
      row.registerName,
      row.fieldName,
      row.bitRange,
      row.width,
      row.type,
      row.resetValue,
      row.description,
    ]),
  ]

  const sheet = XLSX.utils.aoa_to_sheet(data)

  sheet['!cols'] = REGISTER_HEADERS.map((_, col) => ({
    wch: Math.max(10, ...data.map((row) => String(row[col] ?? '').length + 2)),
  }))

  const range = XLSX.utils.decode_range(sheet['!ref'])

  for (let row = range.s.r; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })]
      if (!cell) continue

      if (row === 0) {
        cell.s = {
          fill: { fgColor: { rgb: '4472C4' } },
          font: { color: { rgb: 'FFFFFF' }, bold: true },
          border: CELL_BORDER,
          alignment: { horizontal: 'center', vertical: 'center' },
        }
        continue
      }

      cell.s = rows[row - 1]?.isRegisterRow
        ? {
            fill: { fgColor: { rgb: 'D6DCE4' } },
            font: { bold: col === 1, italic: col === 7 },
            border: CELL_BORDER,
          }
        : { border: CELL_BORDER }
    }
  }

  return sheet
}

/** Arrays document an address expression instead of a single address. */
const registerAddress = (addr, reg) => {
  const base = `0x${addr.toString(16).toUpperCase()}`

  if (!reg?.array) {
    return base
  }

  return `${formatArrayAddress(addr, reg.array)} (${formatArrayRange(reg.array)})`
}

/**
 * Generate Excel data for preview
 * @param {object} params - Document parameters (moduleName, dataWidth, addrWidth, interface)
 * @param {object} registers - Register data object
 * @returns {object} Object containing summary and registers data for preview
 */
export const generateExcelData = (params, registers) => {
  const summary = {
    moduleName: params.moduleName,
    dataWidth: params.dataWidth,
    addrWidth: params.addrWidth,
    interface: params.interface,
    generatedAt: new Date().toISOString(),
  }

  const registerRows = Object.keys(registers)
    .map(Number)
    .sort((a, b) => a - b)
    .flatMap((addr) =>
      registerBlock(
        registerAddress(addr, registers[addr]),
        registers[addr].name,
        registers[addr],
        params
      )
    )

  return {
    summary,
    registers: registerRows,
    flat: flattenRegisters(params, registers),
  }
}

/**
 * Export CSR document to Excel format
 * @param {string} filename - Output filename (without extension)
 * @param {object} params - Document parameters (moduleName, dataWidth, addrWidth, interface)
 * @param {object} registers - Register data object
 */
export const exportToExcel = (filename, params, registers) => {
  const workbook = XLSX.utils.book_new()

  // Sheet 1: Register Summary
  const summaryData = [
    ['CSR Document Summary'],
    [],
    ['Parameter', 'Value'],
    ['Module Name', params.moduleName],
    ['Data Width', `${params.dataWidth} bits`],
    ['Address Width', `${params.addrWidth} bits`],
    ['Interface', params.interface],
    ['Generated At', new Date().toISOString()],
  ]

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  
  // Set column widths for summary sheet
  summarySheet['!cols'] = [
    { wch: 20 }, // Parameter column
    { wch: 30 }, // Value column
  ]
  
  // Apply styles to summary sheet
  // Title row (row 0)
  const titleAddr = 'A1'
  if (summarySheet[titleAddr]) {
    summarySheet[titleAddr].s = {
      fill: { fgColor: { rgb: '4472C4' } }, // Blue background
      font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 16 }, // White bold larger text
      border: {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } },
      },
      alignment: { horizontal: 'center', vertical: 'center' },
    }
    // Merge cells for title
    summarySheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
  }
  
  // Header row (row 2)
  for (let col = 0; col <= 1; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 2, c: col })
    if (!summarySheet[cellAddr]) continue
    summarySheet[cellAddr].s = {
      fill: { fgColor: { rgb: '4472C4' } }, // Blue background
      font: { color: { rgb: 'FFFFFF' }, bold: true }, // White bold text
      border: {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } },
      },
      alignment: { horizontal: 'center', vertical: 'center' },
    }
  }
  
  // Data rows (row 3+)
  for (let row = 3; row < summaryData.length; row++) {
    for (let col = 0; col <= 1; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r: row, c: col })
      if (!summarySheet[cellAddr]) continue
      summarySheet[cellAddr].s = {
        border: {
          top: { style: 'thin', color: { rgb: '000000' } },
          bottom: { style: 'thin', color: { rgb: '000000' } },
          left: { style: 'thin', color: { rgb: '000000' } },
          right: { style: 'thin', color: { rgb: '000000' } },
        },
        alignment: { horizontal: col === 0 ? 'left' : 'left', vertical: 'center' },
      }
    }
  }
  
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')

  // Sheet 2: the register listing, arrays documented once as an expression
  const registerSheet = buildRegisterSheet(
    generateExcelData(params, registers).registers
  )
  XLSX.utils.book_append_sheet(workbook, registerSheet, 'Registers')

  // Sheet 3: the same listing with every array expanded into its instances
  const flatSheet = buildRegisterSheet(flattenRegisters(params, registers))
  XLSX.utils.book_append_sheet(workbook, flatSheet, 'Flat Registers')

  // Write file
  XLSX.writeFile(workbook, `${filename}.xlsx`)
}
