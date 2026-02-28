const NATIVE_INTERFACE = 'Native'
const AVALON_MM_INTERFACE = 'AvalonMM'

const sanitizeName = (value) => {
  let out = value.trim().toLowerCase().replace(/[^a-zA-Z0-9_]/g, '_')
  out = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '')

  if (!out) {
    throw new Error(`Invalid empty identifier from '${value}'`)
  }

  if (/^\d/.test(out)) {
    out = `n_${out}`
  }

  return out
}

const sanitizeConst = (value) => {
  let out = value.trim().toUpperCase().replace(/[^a-zA-Z0-9_]/g, '_')
  out = out.replace(/_+/g, '_').replace(/^_+|_+$/g, '')

  if (!out) {
    throw new Error(`Invalid empty const identifier from '${value}'`)
  }

  if (/^\d/.test(out)) {
    out = `N_${out}`
  }

  return out
}

const widthDecl = (width) => (width === 1 ? '' : `[${width - 1}:0] `)
const bitSel = (msb, lsb) => (msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`)
const resetLiteral = (width, value) => `${width}'d${value}`
const moduleNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

const buildRegisterModel = (params = {}, registerMap = {}) => {
  const dataWidth = Number(params.dataWidth ?? 32)
  const addrWidth = Number(params.addrWidth ?? 16)
  const csrInterface = params.interface ?? NATIVE_INTERFACE
  const moduleName = String(params.moduleName ?? 'CSR').trim()
  const step = dataWidth / 8

  if (!Number.isInteger(dataWidth) || !Number.isInteger(addrWidth)) {
    throw new Error('addrWidth/dataWidth must be integers')
  }

  if (dataWidth <= 0 || addrWidth <= 0) {
    throw new Error('addrWidth/dataWidth must be positive')
  }

  if (!Number.isInteger(step) || step <= 0) {
    throw new Error('dataWidth must be byte-aligned')
  }

  if (![NATIVE_INTERFACE, AVALON_MM_INTERFACE].includes(csrInterface)) {
    throw new Error(`Unsupported interface '${csrInterface}'`)
  }

  if (!moduleNamePattern.test(moduleName)) {
    throw new Error(`Invalid moduleName '${moduleName}'`)
  }

  const regs = Object.entries(registerMap).map(([addrText, register]) => {
    const fields = (register?.fields ?? []).map((field) => {
      const msb = Number(field?.bitRange?.msb)
      const lsb = Number(field?.bitRange?.lsb)

      return {
        name: String(field?.name ?? ''),
        access: String(field?.type ?? '').toUpperCase(),
        msb,
        lsb,
        reset: Number(field?.resetValue ?? 0),
        width: msb - lsb + 1,
        signalBase: sanitizeName(String(field?.name ?? '')),
      }
    })

    const name = String(register?.name ?? `REG_${addrText}`)
    const base = name.toLowerCase().replace(/_\d+$/, '')
    const prefix = sanitizeName(base.split('_')[0] ?? name)

    return {
      addr: Number(addrText),
      name,
      constName: sanitizeConst(name),
      prefix,
      fields,
    }
  })

  regs.sort((a, b) => a.addr - b.addr)

  const seenAddrs = new Set()
  const seenNames = new Set()

  for (const reg of regs) {
    if (!Number.isInteger(reg.addr)) {
      throw new Error(`Invalid register address '${reg.addr}'`)
    }

    if (seenAddrs.has(reg.addr)) {
      throw new Error(`Duplicate register address ${reg.addr}`)
    }
    seenAddrs.add(reg.addr)

    if (seenNames.has(reg.name)) {
      throw new Error(`Duplicate register name '${reg.name}'`)
    }
    seenNames.add(reg.name)

    if (reg.addr < 0 || reg.addr >= 2 ** addrWidth) {
      throw new Error(`Register ${reg.name} address ${reg.addr} out of addrWidth range`)
    }

    if (reg.addr % step !== 0) {
      throw new Error(`Register ${reg.name} address ${reg.addr} must be ${step}-byte aligned`)
    }

    const usedBits = new Set()

    for (const field of reg.fields) {
      if (!Number.isInteger(field.msb) || !Number.isInteger(field.lsb)) {
        throw new Error(`${reg.name}.${field.name}: invalid bitRange`)
      }

      if (!['RW', 'RO'].includes(field.access)) {
        throw new Error(`${reg.name}.${field.name}: unsupported access '${field.access}'`)
      }

      if (field.lsb < 0 || field.msb < field.lsb || field.msb >= dataWidth) {
        throw new Error(
          `${reg.name}.${field.name}: invalid bitRange [${field.msb}:${field.lsb}] for dataWidth=${dataWidth}`
        )
      }

      const maxValue = 2 ** field.width - 1
      if (!Number.isInteger(field.reset) || field.reset < 0 || field.reset > maxValue) {
        throw new Error(
          `${reg.name}.${field.name}: resetValue ${field.reset} does not fit width ${field.width}`
        )
      }

      for (let bit = field.lsb; bit <= field.msb; bit += 1) {
        if (usedBits.has(bit)) {
          throw new Error(`${reg.name}: overlapping field bit ${bit}`)
        }
        usedBits.add(bit)
      }
    }
  }

  return {
    addrWidth,
    dataWidth,
    interface: csrInterface,
    moduleName,
    regs,
  }
}

const renderCsrBlock = ({ addrWidth, dataWidth, regs, blockModuleName }) => {
  const rwPorts = []
  const roPorts = []

  for (const reg of regs) {
    for (const field of reg.fields) {
      const sig = `${reg.prefix}_${field.signalBase}`
      const port = { sig, width: field.width, reset: field.reset, field }
      if (field.access === 'RW') {
        rwPorts.push(port)
      } else {
        roPorts.push(port)
      }
    }
  }

  const lines = [
    `module ${blockModuleName} #(`,
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}`,
    ') (',
    '    input  wire                  clk_i,',
    '    input  wire                  rstn_i,',
    '    input  wire                  csr_wr_en_i,',
    '    input  wire                  csr_rd_en_i,',
    '    input  wire [ADDR_WIDTH-1:0] csr_addr_i,',
    '    input  wire [DATA_WIDTH-1:0] csr_wdata_i,',
    '    output reg  [DATA_WIDTH-1:0] csr_rdata_o,',
  ]

  if (rwPorts.length > 0) {
    lines.push('', '    // RW register outputs')
    rwPorts.forEach((port, index) => {
      const hasTrailing = index < rwPorts.length - 1 || roPorts.length > 0
      lines.push(`    output reg  ${widthDecl(port.width)}${port.sig}_o${hasTrailing ? ',' : ''}`)
    })
  }

  if (roPorts.length > 0) {
    lines.push('', '    // RO register inputs')
    roPorts.forEach((port, index) => {
      const hasTrailing = index < roPorts.length - 1
      lines.push(`    input  wire ${widthDecl(port.width)}${port.sig}_i${hasTrailing ? ',' : ''}`)
    })
  }

  lines.push(');', '')

  for (const reg of regs) {
    lines.push(
      `  localparam [ADDR_WIDTH-1:0] ${reg.constName}_ADDR = ADDR_WIDTH'(${reg.addr});`
    )
  }

  lines.push('', '  // CSR write handling', '  always @(posedge clk_i or negedge rstn_i) begin')
  lines.push('    if (!rstn_i) begin')

  if (rwPorts.length > 0) {
    for (const port of rwPorts) {
      lines.push(`      ${port.sig}_o <= ${resetLiteral(port.width, port.reset)};`)
    }
  }

  lines.push('    end else begin', '      if (csr_wr_en_i) begin', '        case (csr_addr_i)')

  for (const reg of regs) {
    const rwFields = reg.fields.filter((field) => field.access === 'RW')
    if (rwFields.length === 0) {
      continue
    }

    lines.push(`          ${reg.constName}_ADDR: begin`)
    for (const field of rwFields) {
      const sig = `${reg.prefix}_${field.signalBase}`
      lines.push(`            ${sig}_o <= csr_wdata_i${bitSel(field.msb, field.lsb)};`)
    }
    lines.push('          end')
  }

  lines.push(
    '          default: begin',
    '            // no-op for unmapped writes',
    '          end',
    '        endcase',
    '      end',
    '    end',
    '  end',
    '',
    '  // Readback path',
    '  always @(*) begin',
    '    csr_rdata_o = {DATA_WIDTH{1\'b0}};',
    '',
    '    if (csr_rd_en_i) begin',
    '      case (csr_addr_i)'
  )

  for (const reg of regs) {
    lines.push(`        ${reg.constName}_ADDR: begin`)
    for (const field of reg.fields) {
      const sig = `${reg.prefix}_${field.signalBase}`
      const suffix = field.access === 'RW' ? '_o' : '_i'
      lines.push(`          csr_rdata_o${bitSel(field.msb, field.lsb)} = ${sig}${suffix};`)
    }
    lines.push('        end')
  }

  lines.push(
    '        default: begin',
    '          csr_rdata_o = {DATA_WIDTH{1\'b0}};',
    '        end',
    '      endcase',
    '    end',
    '  end',
    '',
    'endmodule',
    ''
  )

  return lines.join('\n')
}

const renderAvalonBridge = ({ addrWidth, dataWidth }) => {
  const byteLanes = dataWidth / 8
  const byteMask = []

  for (let index = byteLanes - 1; index >= 0; index -= 1) {
    byteMask.push(`        {8{avmm_byteenable_i[${index}]}}`)
  }

  return [
    '// Avalon-MM to native CSR bridge that converts Avalon transactions into',
    '// single-cycle native accesses.',
    'module csr_avalon_bridge #(',
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}`,
    ') (',
    '    input  wire                     clk_i,',
    '    input  wire                     rstn_i,',
    '    // Avalon-MM slave interface',
    '    input  wire                     avmm_read_i,',
    '    input  wire                     avmm_write_i,',
    '    input  wire [ADDR_WIDTH-1:0]    avmm_address_i,',
    '    input  wire [(DATA_WIDTH/8)-1:0] avmm_byteenable_i,',
    '    input  wire [DATA_WIDTH-1:0]    avmm_writedata_i,',
    '    output wire                     avmm_waitrequest_o,',
    '    output wire [1:0]               avmm_response_o,',
    '    output wire [DATA_WIDTH-1:0]    avmm_readdata_o,',
    '    // Native CSR bus',
    '    output wire                     native_wr_en_o,',
    '    output wire                     native_rd_en_o,',
    '    output wire [ADDR_WIDTH-1:0]    native_addr_o,',
    '    output wire [DATA_WIDTH-1:0]    native_wdata_o,',
    '    input  wire [DATA_WIDTH-1:0]    native_rdata_i',
    ');',
    '',
    '    localparam int BYTE_LANES = DATA_WIDTH / 8;',
    '',
    '    assign native_addr_o = avmm_address_i;',
    '',
    '    wire write_has_enable = |avmm_byteenable_i;',
    '    wire do_write         = avmm_write_i && write_has_enable;',
    '    wire full_write       = (avmm_byteenable_i == {BYTE_LANES{1\'b1}});',
    '    wire partial_write    = do_write && !full_write;',
    '    wire do_read          = avmm_read_i;',
    '',
    '    assign native_wr_en_o = do_write;',
    '    assign native_rd_en_o = do_read || partial_write;',
    '',
    '    wire [DATA_WIDTH-1:0] byte_mask = {',
    ...byteMask,
    '    };',
    '',
    '    wire [DATA_WIDTH-1:0] merged_wdata = (avmm_writedata_i & byte_mask) |',
    '                                         (native_rdata_i & ~byte_mask);',
    '',
    '    assign native_wdata_o = partial_write ? merged_wdata : avmm_writedata_i;',
    '',
    '    assign avmm_waitrequest_o = 1\'b0;',
    '    assign avmm_response_o    = 2\'b00;',
    '    assign avmm_readdata_o    = native_rdata_i;',
    '',
    'endmodule',
    '',
  ].join('\n')
}

const renderCsrTop = ({ addrWidth, dataWidth, regs, moduleName, blockModuleName }) => {
  const rwPorts = []
  const roPorts = []

  for (const reg of regs) {
    for (const field of reg.fields) {
      const sig = `${reg.prefix}_${field.signalBase}`
      const port = `    ${field.access === 'RW' ? 'output' : 'input '} wire ${widthDecl(
        field.width
      )}${sig}_${field.access === 'RW' ? 'o' : 'i'},`
      if (field.access === 'RW') {
        rwPorts.push(port)
      } else {
        roPorts.push(port)
      }
    }
  }

  if (roPorts.length > 0) {
    roPorts[roPorts.length - 1] = roPorts[roPorts.length - 1].replace(/,$/, '')
  } else if (rwPorts.length > 0) {
    rwPorts[rwPorts.length - 1] = rwPorts[rwPorts.length - 1].replace(/,$/, '')
  }

  const lines = [
    '// Top-level module that connects a single Avalon-MM bridge to the native CSR block.',
    `module ${moduleName} #(`,
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}`,
    ') (',
    '    input  wire                  clk_i,',
    '    input  wire                  rstn_i,',
    '    // Avalon-MM slave interface',
    '    input  wire                  avmm_read_i,',
    '    input  wire                  avmm_write_i,',
    '    input  wire [ADDR_WIDTH-1:0] avmm_address_i,',
    '    input  wire [(DATA_WIDTH/8)-1:0] avmm_byteenable_i,',
    '    input  wire [DATA_WIDTH-1:0] avmm_writedata_i,',
    '    output wire                  avmm_waitrequest_o,',
    '    output wire [1:0]            avmm_response_o,',
    '    output wire [DATA_WIDTH-1:0] avmm_readdata_o,',
  ]

  if (rwPorts.length > 0 || roPorts.length > 0) {
    lines.push('    // Native CSR connections')
    lines.push(...rwPorts)
    lines.push(...roPorts)
  }

  lines.push(');', '', '  wire                  native_wr_en;')
  lines.push('  wire                  native_rd_en;')
  lines.push('  wire [ADDR_WIDTH-1:0] native_addr;')
  lines.push('  wire [DATA_WIDTH-1:0] native_wdata;')
  lines.push('  wire [DATA_WIDTH-1:0] native_rdata;', '')
  lines.push('  csr_avalon_bridge #(')
  lines.push('      .ADDR_WIDTH(ADDR_WIDTH),')
  lines.push('      .DATA_WIDTH(DATA_WIDTH)')
  lines.push('  ) u_bridge (')
  lines.push('      .clk_i             (clk_i),')
  lines.push('      .rstn_i            (rstn_i),')
  lines.push('      .avmm_read_i       (avmm_read_i),')
  lines.push('      .avmm_write_i      (avmm_write_i),')
  lines.push('      .avmm_address_i    (avmm_address_i),')
  lines.push('      .avmm_byteenable_i (avmm_byteenable_i),')
  lines.push('      .avmm_writedata_i  (avmm_writedata_i),')
  lines.push('      .avmm_waitrequest_o(avmm_waitrequest_o),')
  lines.push('      .avmm_response_o   (avmm_response_o),')
  lines.push('      .avmm_readdata_o   (avmm_readdata_o),')
  lines.push('      .native_wr_en_o    (native_wr_en),')
  lines.push('      .native_rd_en_o    (native_rd_en),')
  lines.push('      .native_addr_o     (native_addr),')
  lines.push('      .native_wdata_o    (native_wdata),')
  lines.push('      .native_rdata_i    (native_rdata)')
  lines.push('  );', '', `  ${blockModuleName} #(`)
  lines.push('      .ADDR_WIDTH        (ADDR_WIDTH),')
  lines.push('      .DATA_WIDTH        (DATA_WIDTH)')
  lines.push('  ) u_csr (')
  lines.push('      .clk_i                 (clk_i),')
  lines.push('      .rstn_i                (rstn_i),')
  lines.push('      .csr_wr_en_i           (native_wr_en),')
  lines.push('      .csr_rd_en_i           (native_rd_en),')
  lines.push('      .csr_addr_i            (native_addr),')
  lines.push('      .csr_wdata_i           (native_wdata),')
  lines.push('      .csr_rdata_o           (native_rdata),')

  const signalLines = []
  for (const reg of regs) {
    for (const field of reg.fields) {
      const sig = `${reg.prefix}_${field.signalBase}`
      const suffix = field.access === 'RW' ? '_o' : '_i'
      signalLines.push(`      .${sig}${suffix}${' '.repeat(Math.max(1, 21 - (sig.length + suffix.length)))}(${sig}${suffix}),`)
    }
  }

  if (signalLines.length > 0) {
    signalLines[signalLines.length - 1] = signalLines[signalLines.length - 1].replace(/,$/, '')
    lines.push(...signalLines)
  }

  lines.push('  );', '', 'endmodule', '')

  return lines.join('\n')
}

export const generateRtlFiles = (doc) => {
  const model = buildRegisterModel(doc?.params, doc?.registers)
  const blockModuleName =
    model.interface === AVALON_MM_INTERFACE
      ? `${model.moduleName}_csr`
      : model.moduleName
  const files = [
    {
      name:
        model.interface === AVALON_MM_INTERFACE
          ? `${model.moduleName}_csr.sv`
          : `${model.moduleName}.sv`,
      content: renderCsrBlock({
        ...model,
        blockModuleName,
      }),
    },
  ]

  if (model.interface === AVALON_MM_INTERFACE) {
    files.push(
      {
        name: 'csr_avalon_bridge.sv',
        content: renderAvalonBridge(model),
      },
      {
        name: `${model.moduleName}.sv`,
        content: renderCsrTop({
          ...model,
          blockModuleName,
        }),
      }
    )
  }

  return files
}

export const supportedInterfaces = [NATIVE_INTERFACE, AVALON_MM_INTERFACE]
