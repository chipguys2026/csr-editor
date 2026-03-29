import * as XLSX from 'xlsx-js-style'

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

  const registerRows = []
  const sortedAddrs = Object.keys(registers)
    .map((addr) => Number(addr))
    .sort((a, b) => a - b)

  sortedAddrs.forEach((addr) => {
    const reg = registers[addr]
    // Add register header row
    registerRows.push({
      isRegisterRow: true,
      address: `0x${addr.toString(16).toUpperCase()}`,
      registerName: reg.name,
      fieldName: '',
      bitRange: '',
      width: '',
      type: '',
      resetValue: '',
      description: reg.description,
    })
    // Add field rows
    reg.fields.forEach((field) => {
      const bitRange = `[${field.bitRange.msb}:${field.bitRange.lsb}]`
      const width = field.bitRange.msb - field.bitRange.lsb + 1
      const resetValueHex = `0x${field.resetValue.toString(16).toUpperCase()}`
      registerRows.push({
        isRegisterRow: false,
        address: '',
        registerName: '',
        fieldName: field.name,
        bitRange,
        width,
        type: field.type,
        resetValue: resetValueHex,
        description: field.desc,
      })
    })
  })

  return { summary, registers: registerRows }
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

  // Sheet 2: Register Map & Details (combined)
  const registerData = [
    [
      'Address',
      'Register Name',
      'Field Name',
      'Bit Range',
      'Width',
      'Type',
      'Reset Value',
      'Description',
    ],
  ]

  const sortedAddrs = Object.keys(registers)
    .map((addr) => Number(addr))
    .sort((a, b) => a - b)

  sortedAddrs.forEach((addr) => {
    const reg = registers[addr]
    // Add register header row with description
    registerData.push([
      `0x${addr.toString(16).toUpperCase()}`,
      reg.name,
      '',
      '',
      '',
      '',
      '',
      reg.description,
    ])
    // Add field rows
    reg.fields.forEach((field) => {
      const bitRange = `[${field.bitRange.msb}:${field.bitRange.lsb}]`
      const width = field.bitRange.msb - field.bitRange.lsb + 1
      const resetValueHex = `0x${field.resetValue.toString(16).toUpperCase()}`
      registerData.push([
        '',
        '',
        field.name,
        bitRange,
        width,
        field.type,
        resetValueHex,
        field.desc,
      ])
    })
  })

  const registerSheet = XLSX.utils.aoa_to_sheet(registerData)

  // Calculate auto column widths based on content
  const colWidths = []
  for (let col = 0; col < 8; col++) {
    let maxWidth = 0
    // Check header
    const headerCell = registerData[0][col]
    if (headerCell) {
      maxWidth = Math.max(maxWidth, String(headerCell).length)
    }
    // Check all data rows
    for (let row = 1; row < registerData.length; row++) {
      const cellValue = registerData[row][col]
      if (cellValue !== undefined && cellValue !== '') {
        maxWidth = Math.max(maxWidth, String(cellValue).length)
      }
    }
    // Add padding and set minimum width
    colWidths.push({ wch: Math.max(maxWidth + 2, 10) })
  }
  registerSheet['!cols'] = colWidths

  // Apply styles using sheetjs-style
  const range = XLSX.utils.decode_range(registerSheet['!ref'])
  
  // Header row style (row 0)
  for (let col = range.s.c; col <= range.e.c; col++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c: col })
    if (!registerSheet[cellAddr]) continue
    registerSheet[cellAddr].s = {
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

  // Data rows style
  for (let row = 1; row <= range.e.r; row++) {
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddr = XLSX.utils.encode_cell({ r: row, c: col })
      if (!registerSheet[cellAddr]) continue
      
      // Check if this is a register header row (has address)
      const addrCell = registerSheet[XLSX.utils.encode_cell({ r: row, c: 0 })]
      const isRegisterRow = addrCell && addrCell.v && addrCell.v.startsWith('0x')
      
      if (isRegisterRow) {
        // Register header row - light gray for entire row
        registerSheet[cellAddr].s = {
          fill: { fgColor: { rgb: 'D6DCE4' } }, // Light gray background
          font: { bold: col === 1, italic: col === 7 }, // Bold for Register Name, italic for Description
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } },
          },
        }
      } else {
        // Field rows - default style with borders
        registerSheet[cellAddr].s = {
          border: {
            top: { style: 'thin', color: { rgb: '000000' } },
            bottom: { style: 'thin', color: { rgb: '000000' } },
            left: { style: 'thin', color: { rgb: '000000' } },
            right: { style: 'thin', color: { rgb: '000000' } },
          },
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(workbook, registerSheet, 'Registers')

  // Write file
  XLSX.writeFile(workbook, `${filename}.xlsx`)
}
