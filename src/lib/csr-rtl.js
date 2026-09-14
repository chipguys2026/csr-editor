const NATIVE_INTERFACE = 'Native'
const AVALON_MM_INTERFACE = 'AvalonMM'
const AXI4_LITE_INTERFACE = 'AXI4Lite'

// Access types the generator knows how to emit.
//   RW   software read/write storage
//   RO   hardware drives the value, software reads it
//   W1C  hardware sets, software writes 1 to clear
//   W1S  software writes 1 to set, hardware clears
//   W1P  software writes 1 to pulse for one cycle, reads back 0
//   W1SC software writes 1 to set, bit self-clears after one cycle, reads back 0
const ACCESS_TYPES = ['RW', 'RO', 'W1C', 'W1S', 'W1P', 'W1SC']
const PULSE_TYPES = ['W1P', 'W1SC']

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
const constLiteral = (width, value) => `${width}'h${value.toString(16).toUpperCase()}`
const moduleNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/

// Registers that need a write-strobe flop: those exposing one, and those whose
// write advances a paired auto-incrementing address register.
const needsStrobe = (reg) => reg.writeStrobe || reg.autoIncrementTargets.length > 0

// Fields that own a flop inside the CSR block (everything except RO).
const isStateful = (field) => field.access !== 'RO'

// Ports the CSR block exposes for a field, in declaration order.
const fieldPorts = (field) => {
  const { sig, width } = field

  switch (field.access) {
    case 'RW':
      return [{ dir: 'output', name: `${sig}_o`, width }]
    case 'RO':
      // A constant RO field is tied off internally, so it needs no port.
      return field.constant ? [] : [{ dir: 'input', name: `${sig}_i`, width }]
    case 'W1C':
      // Hardware set request, OR'd in every cycle, plus the current value.
      return [
        { dir: 'input', name: `${sig}_i`, width },
        { dir: 'output', name: `${sig}_o`, width },
      ]
    case 'W1S':
      // Current value plus a hardware clear request, AND'd with its inverse.
      return [
        { dir: 'output', name: `${sig}_o`, width },
        { dir: 'input', name: `${sig}_clr_i`, width },
      ]
    case 'W1P':
    case 'W1SC':
      return [{ dir: 'output', name: `${sig}_o`, width }]
    default:
      throw new Error(`Unsupported access '${field.access}'`)
  }
}

const collectPorts = (regs) => {
  const outputs = []
  const inputs = []

  for (const reg of regs) {
    if (reg.writeStrobe) {
      outputs.push({ dir: 'output', name: `${reg.prefix}_wr_o`, width: 1, wireOut: true })
    }

    for (const field of reg.fields) {
      for (const port of fieldPorts(field)) {
        if (port.dir === 'output') {
          outputs.push(port)
        } else {
          inputs.push(port)
        }
      }
    }
  }

  return { outputs, inputs }
}

const declLine = (port, asReg) => {
  const dir = port.dir === 'output' ? 'output' : 'input '
  const kind = port.dir === 'output' && asReg && !port.wireOut ? 'reg ' : 'wire'
  return `    ${dir} ${kind} ${widthDecl(port.width)}${port.name}`
}

// Appends a comma to every entry but the last.
const commaJoin = (entries) =>
  entries.map((entry, index) => (index < entries.length - 1 ? `${entry},` : entry))

// What the readback mux returns for a field. Pulse types always read back 0.
const readExpr = (field) => {
  if (field.access === 'RO') {
    return field.constant ? constLiteral(field.width, field.reset) : `${field.sig}_i`
  }

  if (PULSE_TYPES.includes(field.access)) {
    return resetLiteral(field.width, 0)
  }

  return `${field.sig}_o`
}

// Update applied every cycle from hardware, independent of software writes.
const hardwareUpdate = (field) => {
  const { sig } = field

  switch (field.access) {
    case 'W1C':
      return `${sig}_o <= ${sig}_o | ${sig}_i;`
    case 'W1S':
      return `${sig}_o <= ${sig}_o & ~${sig}_clr_i;`
    case 'W1P':
    case 'W1SC':
      return `${sig}_o <= ${resetLiteral(field.width, 0)};`
    default:
      return null
  }
}

// Update applied when software writes the register. Runs after the hardware
// update in the same always block, so the non-blocking assignment here wins.
//
// Every write is qualified by csr_wr_mask, the per-bit expansion of the byte
// enables. Bits in a disabled lane contribute nothing, which is the no-op each
// access type defines: RW keeps its flop, and the write-one-to-X types see a 0.
// Masking here rather than doing a read-modify-write in the bridge is what
// keeps a byte write from clobbering an untouched W1C status bit.
const writeUpdate = (field) => {
  const { sig } = field
  const slice = bitSel(field.msb, field.lsb)
  const wdata = `(csr_wdata_i${slice} & csr_wr_mask${slice})`

  switch (field.access) {
    case 'RW':
      return `${sig}_o <= ${wdata} | (${sig}_o & ~csr_wr_mask${slice});`
    case 'W1C':
      // A concurrent hardware set wins over the software clear so events are
      // never lost.
      return `${sig}_o <= (${sig}_o & ~${wdata}) | ${sig}_i;`
    case 'W1S':
      // A concurrent software set wins over the hardware clear.
      return `${sig}_o <= (${sig}_o & ~${sig}_clr_i) | ${wdata};`
    case 'W1P':
    case 'W1SC':
      return `${sig}_o <= ${wdata};`
    default:
      return null
  }
}

const buildRegisterModel = (params = {}, registerMap = {}) => {
  const dataWidth = Number(params.dataWidth ?? 32)
  const addrWidth = Number(params.addrWidth ?? 16)
  const csrInterface = params.interface ?? NATIVE_INTERFACE
  const moduleName = String(params.moduleName ?? 'CSR').trim()
  const registeredReadback = Boolean(params.registeredReadback)
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

  if (![NATIVE_INTERFACE, AVALON_MM_INTERFACE, AXI4_LITE_INTERFACE].includes(csrInterface)) {
    throw new Error(`Unsupported interface '${csrInterface}'`)
  }

  if (!moduleNamePattern.test(moduleName)) {
    throw new Error(`Invalid moduleName '${moduleName}'`)
  }

  const regs = Object.entries(registerMap).map(([addrText, register]) => {
    const name = String(register?.name ?? `REG_${addrText}`)
    const constName = sanitizeConst(name)
    const prefix = sanitizeName(name)

    const fields = (register?.fields ?? []).map((field) => {
      const msb = Number(field?.bitRange?.msb)
      const lsb = Number(field?.bitRange?.lsb)
      const signalBase = sanitizeName(String(field?.name ?? ''))

      return {
        name: String(field?.name ?? ''),
        access: String(field?.type ?? '').toUpperCase(),
        msb,
        lsb,
        reset: Number(field?.resetValue ?? 0),
        width: msb - lsb + 1,
        constant: Boolean(field?.constant),
        signalBase,
        sig: `${prefix}_${signalBase}`,
      }
    })

    return {
      addr: Number(addrText),
      name,
      constName,
      prefix,
      fields,
      // Opt-in single-cycle output pulsed on a software write to this register.
      writeStrobe: Boolean(register?.writeStrobe),
      // Name of the register whose write auto-increments this one.
      autoIncrementOn:
        register?.autoIncrementOn == null ? null : String(register.autoIncrementOn),
      // Filled in below: registers that auto-increment when this one is written.
      autoIncrementTargets: [],
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

      if (!ACCESS_TYPES.includes(field.access)) {
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

      if (field.constant && field.access !== 'RO') {
        throw new Error(
          `${reg.name}.${field.name}: constant is only valid on RO fields, not '${field.access}'`
        )
      }

      if (PULSE_TYPES.includes(field.access) && field.reset !== 0) {
        throw new Error(
          `${reg.name}.${field.name}: ${field.access} fields must have resetValue 0, would pulse out of reset`
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

  resolveAutoIncrement(regs)
  checkPortNames(regs)

  return {
    addrWidth,
    dataWidth,
    interface: csrInterface,
    moduleName,
    registeredReadback,
    regs,
  }
}

// Links each auto-incrementing address register to the register whose write
// advances it, so the trigger's write arm can emit the increment.
const resolveAutoIncrement = (regs) => {
  const byName = new Map(regs.map((reg) => [reg.name, reg]))

  for (const reg of regs) {
    if (!reg.autoIncrementOn) {
      continue
    }

    const trigger = byName.get(reg.autoIncrementOn)

    if (!trigger) {
      throw new Error(
        `${reg.name}: autoIncrementOn references unknown register '${reg.autoIncrementOn}'`
      )
    }

    if (trigger === reg) {
      throw new Error(`${reg.name}: autoIncrementOn cannot reference itself`)
    }

    const rwFields = reg.fields.filter((field) => field.access === 'RW')

    if (rwFields.length !== 1) {
      throw new Error(
        `${reg.name}: autoIncrementOn needs exactly one RW field to increment, found ${rwFields.length}`
      )
    }

    trigger.autoIncrementTargets.push(rwFields[0])
  }
}

// Every emitted port name must be unique. Distinct register/field names can
// still sanitize to the same identifier, and a field named 'wr' collides with a
// register's write strobe.
const checkPortNames = (regs) => {
  const { outputs, inputs } = collectPorts(regs)
  const seen = new Set()

  for (const port of [...outputs, ...inputs]) {
    if (seen.has(port.name)) {
      throw new Error(`Duplicate RTL port name '${port.name}'`)
    }
    seen.add(port.name)
  }
}

const renderCsrBlock = ({
  addrWidth,
  dataWidth,
  regs,
  blockModuleName,
  registeredReadback,
}) => {
  const { outputs, inputs } = collectPorts(regs)
  const readTarget = registeredReadback ? 'csr_rdata_next' : 'csr_rdata_o'

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
    '    input  wire [(DATA_WIDTH/8)-1:0] csr_be_i,',
    '    input  wire [DATA_WIDTH-1:0] csr_wdata_i,',
    '    output reg  [DATA_WIDTH-1:0] csr_rdata_o,',
  ]

  const portDecls = []

  if (outputs.length > 0) {
    portDecls.push('', '    // Register value outputs')
    portDecls.push(...outputs.map((port) => declLine(port, true)))
  }

  if (inputs.length > 0) {
    portDecls.push('', '    // Hardware inputs')
    portDecls.push(...inputs.map((port) => declLine(port, true)))
  }

  // Only the declaration lines take commas; blank lines and comments do not.
  const declIndexes = portDecls
    .map((line, index) => (line.trim().startsWith('//') || line === '' ? -1 : index))
    .filter((index) => index >= 0)

  declIndexes.slice(0, -1).forEach((index) => {
    portDecls[index] = `${portDecls[index]},`
  })

  lines.push(...portDecls)
  lines.push(');', '')

  for (const reg of regs) {
    lines.push(`  localparam [ADDR_WIDTH-1:0] ${reg.constName}_ADDR = ADDR_WIDTH'(${reg.addr});`)
  }

  if (registeredReadback) {
    lines.push('', '  reg [DATA_WIDTH-1:0] csr_rdata_next;')
  }

  lines.push('', '  // Byte enables expanded to a per-bit write mask', '  wire [DATA_WIDTH-1:0] csr_wr_mask = {')
  lines.push(...byteMaskLines(dataWidth, 'csr_be_i', '      '))
  lines.push('  };')

  const statefulFields = regs.flatMap((reg) => reg.fields.filter(isStateful))
  const strobeRegs = regs.filter(needsStrobe)

  if (strobeRegs.length > 0) {
    lines.push('', '  // Write strobes, high for one cycle after a write to the register')
    for (const reg of strobeRegs) {
      lines.push(`  reg ${reg.prefix}_wr_q;`)
    }
    for (const reg of strobeRegs.filter((entry) => entry.writeStrobe)) {
      lines.push(`  assign ${reg.prefix}_wr_o = ${reg.prefix}_wr_q;`)
    }
  }

  lines.push('', '  // CSR write handling', '  always @(posedge clk_i or negedge rstn_i) begin')
  lines.push('    if (!rstn_i) begin')

  for (const field of statefulFields) {
    lines.push(`      ${field.sig}_o <= ${resetLiteral(field.width, field.reset)};`)
  }

  for (const reg of strobeRegs) {
    lines.push(`      ${reg.prefix}_wr_q <= 1'b0;`)
  }

  lines.push('    end else begin')

  const hwUpdates = [
    ...strobeRegs.map((reg) => `${reg.prefix}_wr_q <= 1'b0;`),
    ...statefulFields.map((field) => hardwareUpdate(field)),
  ].filter((update) => update !== null)

  if (hwUpdates.length > 0) {
    lines.push('      // Hardware side effects, overridden below by a software write')
    for (const update of hwUpdates) {
      lines.push(`      ${update}`)
    }
    lines.push('')
  }

  const incRegs = regs.filter((reg) => reg.autoIncrementTargets.length > 0)

  if (incRegs.length > 0) {
    lines.push(
      '      // Auto-increment one cycle after the paired write, so the address',
      '      // output is still the written entry while the strobe is high'
    )
    for (const reg of incRegs) {
      for (const target of reg.autoIncrementTargets) {
        lines.push(`      if (${reg.prefix}_wr_q) begin`)
        lines.push(
          `        ${target.sig}_o <= ${target.sig}_o + ${resetLiteral(target.width, 1)};`
        )
        lines.push('      end')
      }
    }
    lines.push('')
  }

  lines.push('      if (csr_wr_en_i) begin', '        case (csr_addr_i)')

  for (const reg of regs) {
    const writable = reg.fields.filter(isStateful)

    if (writable.length === 0 && !needsStrobe(reg)) {
      continue
    }

    lines.push(`          ${reg.constName}_ADDR: begin`)

    for (const field of writable) {
      lines.push(`            ${writeUpdate(field)}`)
    }

    if (needsStrobe(reg)) {
      lines.push(`            ${reg.prefix}_wr_q <= 1'b1;`)
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
    registeredReadback
      ? '  // Readback path, registered: csr_rdata_o is valid the cycle after csr_rd_en_i'
      : '  // Readback path',
    '  always @(*) begin',
    `    ${readTarget} = {DATA_WIDTH{1'b0}};`,
    '',
    '    if (csr_rd_en_i) begin',
    '      case (csr_addr_i)'
  )

  for (const reg of regs) {
    lines.push(`        ${reg.constName}_ADDR: begin`)
    for (const field of reg.fields) {
      lines.push(`          ${readTarget}${bitSel(field.msb, field.lsb)} = ${readExpr(field)};`)
    }
    lines.push('        end')
  }

  lines.push(
    '        default: begin',
    `          ${readTarget} = {DATA_WIDTH{1'b0}};`,
    '        end',
    '      endcase',
    '    end',
    '  end',
    ''
  )

  if (registeredReadback) {
    lines.push(
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      '      csr_rdata_o <= {DATA_WIDTH{1\'b0}};',
      '    end else begin',
      '      csr_rdata_o <= csr_rdata_next;',
      '    end',
      '  end',
      ''
    )
  }

  lines.push('endmodule', '')

  return lines.join('\n')
}

const byteMaskLines = (dataWidth, strobeName, indent) => {
  const byteLanes = dataWidth / 8
  const out = []

  for (let index = byteLanes - 1; index >= 0; index -= 1) {
    const suffix = index === 0 ? '' : ','
    out.push(`${indent}{8{${strobeName}[${index}]}}${suffix}`)
  }

  return out
}

const renderAvalonBridge = ({ addrWidth, dataWidth, registeredReadback }) =>
  [
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
    '    output wire [(DATA_WIDTH/8)-1:0] native_be_o,',
    '    output wire [DATA_WIDTH-1:0]    native_wdata_o,',
    '    input  wire [DATA_WIDTH-1:0]    native_rdata_i',
    ');',
    '',
    '    assign native_addr_o = avmm_address_i;',
    '',
    '    // Byte enables are passed through to the register block, which masks',
    '    // each field itself. No read-modify-write, so a partial write never',
    '    // reads back and rewrites the lanes it does not touch.',
    '    wire write_has_enable = |avmm_byteenable_i;',
    '',
    '    assign native_wr_en_o = avmm_write_i && write_has_enable;',
    '    assign native_be_o    = avmm_byteenable_i;',
    '    assign native_wdata_o = avmm_writedata_i;',
    '',
    ...(registeredReadback
      ? [
          '    // The register block registers its readback, so a read is held',
          '    // with waitrequest for one cycle while the data lands.',
          '    reg rd_pending;',
          '',
          '    always @(posedge clk_i or negedge rstn_i) begin',
          '        if (!rstn_i) begin',
          '            rd_pending <= 1\'b0;',
          '        end else begin',
          '            rd_pending <= avmm_read_i && !rd_pending;',
          '        end',
          '    end',
          '',
          '    assign native_rd_en_o     = avmm_read_i && !rd_pending;',
          '    assign avmm_waitrequest_o = avmm_read_i && !rd_pending;',
        ]
      : [
          '    assign native_rd_en_o     = avmm_read_i;',
          '    assign avmm_waitrequest_o = 1\'b0;',
        ]),
    '    assign avmm_response_o    = 2\'b00;',
    '    assign avmm_readdata_o    = native_rdata_i;',
    '',
    'endmodule',
    '',
  ].join('\n')

const renderAxiLiteBridge = ({ addrWidth, dataWidth, registeredReadback }) =>
  [
    '// AXI4-Lite to native CSR bridge. One outstanding transaction, writes take',
    '// priority over reads, and every response is OKAY.',
    'module csr_axi4lite_bridge #(',
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}`,
    ') (',
    '    input  wire                      clk_i,',
    '    input  wire                      rstn_i,',
    '    // AXI4-Lite slave interface',
    '    input  wire [ADDR_WIDTH-1:0]     s_axi_awaddr_i,',
    '    input  wire [2:0]                s_axi_awprot_i,',
    '    input  wire                      s_axi_awvalid_i,',
    '    output wire                      s_axi_awready_o,',
    '    input  wire [DATA_WIDTH-1:0]     s_axi_wdata_i,',
    '    input  wire [(DATA_WIDTH/8)-1:0] s_axi_wstrb_i,',
    '    input  wire                      s_axi_wvalid_i,',
    '    output wire                      s_axi_wready_o,',
    '    output wire [1:0]                s_axi_bresp_o,',
    '    output reg                       s_axi_bvalid_o,',
    '    input  wire                      s_axi_bready_i,',
    '    input  wire [ADDR_WIDTH-1:0]     s_axi_araddr_i,',
    '    input  wire [2:0]                s_axi_arprot_i,',
    '    input  wire                      s_axi_arvalid_i,',
    '    output wire                      s_axi_arready_o,',
    '    output reg  [DATA_WIDTH-1:0]     s_axi_rdata_o,',
    '    output wire [1:0]                s_axi_rresp_o,',
    '    output reg                       s_axi_rvalid_o,',
    '    input  wire                      s_axi_rready_i,',
    '    // Native CSR bus',
    '    output wire                      native_wr_en_o,',
    '    output wire                      native_rd_en_o,',
    '    output wire [ADDR_WIDTH-1:0]     native_addr_o,',
    '    output wire [(DATA_WIDTH/8)-1:0] native_be_o,',
    '    output wire [DATA_WIDTH-1:0]     native_wdata_o,',
    '    input  wire [DATA_WIDTH-1:0]     native_rdata_i',
    ');',
    '',
    '    localparam int BYTE_LANES = DATA_WIDTH / 8;',
    '',
    '    localparam [2:0] ST_IDLE  = 3\'d0;',
    '    localparam [2:0] ST_WRITE = 3\'d1;',
    '    localparam [2:0] ST_BRESP = 3\'d2;',
    '    localparam [2:0] ST_READ  = 3\'d3;',
    '    localparam [2:0] ST_RRESP = 3\'d4;',
    ...(registeredReadback ? ['    localparam [2:0] ST_RDATA = 3\'d5;'] : []),
    '',
    '    reg [2:0]              state;',
    '    reg [ADDR_WIDTH-1:0]   addr_q;',
    '    reg [DATA_WIDTH-1:0]   wdata_q;',
    '    reg [BYTE_LANES-1:0]   wstrb_q;',
    '',
    '    wire aw_accept = (state == ST_IDLE) && s_axi_awvalid_i && s_axi_wvalid_i;',
    '',
    '    assign s_axi_awready_o = aw_accept;',
    '    assign s_axi_wready_o  = aw_accept;',
    '    assign s_axi_arready_o = (state == ST_IDLE) && !(s_axi_awvalid_i && s_axi_wvalid_i);',
    '',
    '    assign s_axi_bresp_o = 2\'b00;',
    '    assign s_axi_rresp_o = 2\'b00;',
    '',
    '    always @(posedge clk_i or negedge rstn_i) begin',
    '        if (!rstn_i) begin',
    '            state          <= ST_IDLE;',
    '            addr_q         <= {ADDR_WIDTH{1\'b0}};',
    '            wdata_q        <= {DATA_WIDTH{1\'b0}};',
    '            wstrb_q        <= {BYTE_LANES{1\'b0}};',
    '            s_axi_bvalid_o <= 1\'b0;',
    '            s_axi_rvalid_o <= 1\'b0;',
    '            s_axi_rdata_o  <= {DATA_WIDTH{1\'b0}};',
    '        end else begin',
    '            case (state)',
    '                ST_IDLE: begin',
    '                    if (s_axi_awvalid_i && s_axi_wvalid_i) begin',
    '                        addr_q  <= s_axi_awaddr_i;',
    '                        wdata_q <= s_axi_wdata_i;',
    '                        wstrb_q <= s_axi_wstrb_i;',
    '                        state   <= ST_WRITE;',
    '                    end else if (s_axi_arvalid_i) begin',
    '                        addr_q <= s_axi_araddr_i;',
    '                        state  <= ST_READ;',
    '                    end',
    '                end',
    '',
    '                // Native write is driven combinationally while in this state.',
    '                ST_WRITE: begin',
    '                    s_axi_bvalid_o <= 1\'b1;',
    '                    state          <= ST_BRESP;',
    '                end',
    '',
    '                ST_BRESP: begin',
    '                    if (s_axi_bready_i) begin',
    '                        s_axi_bvalid_o <= 1\'b0;',
    '                        state          <= ST_IDLE;',
    '                    end',
    '                end',
    '',
    ...(registeredReadback
      ? [
          '                // native_rd_en_o is asserted here; the registered',
          '                // readback is valid in the next state.',
          '                ST_READ: begin',
          '                    state <= ST_RDATA;',
          '                end',
          '',
          '                ST_RDATA: begin',
          '                    s_axi_rdata_o  <= native_rdata_i;',
          '                    s_axi_rvalid_o <= 1\'b1;',
          '                    state          <= ST_RRESP;',
          '                end',
        ]
      : [
          '                ST_READ: begin',
          '                    s_axi_rdata_o  <= native_rdata_i;',
          '                    s_axi_rvalid_o <= 1\'b1;',
          '                    state          <= ST_RRESP;',
          '                end',
        ]),
    '',
    '                ST_RRESP: begin',
    '                    if (s_axi_rready_i) begin',
    '                        s_axi_rvalid_o <= 1\'b0;',
    '                        state          <= ST_IDLE;',
    '                    end',
    '                end',
    '',
    '                default: begin',
    '                    state <= ST_IDLE;',
    '                end',
    '            endcase',
    '        end',
    '    end',
    '',
    '    // WSTRB is passed through to the register block, which masks each',
    '    // field itself. No read-modify-write, so a partial write never reads',
    '    // back and rewrites the lanes it does not touch, and the read port',
    '    // stays idle during a write.',
    '    wire write_has_strobe = |wstrb_q;',
    '',
    '    assign native_addr_o  = addr_q;',
    '    assign native_wr_en_o = (state == ST_WRITE) && write_has_strobe;',
    '    assign native_rd_en_o = (state == ST_READ);',
    '    assign native_be_o    = wstrb_q;',
    '    assign native_wdata_o = wdata_q;',
    '',
    'endmodule',
    '',
  ].join('\n')

const AVALON_SLAVE_PORTS = [
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

const AVALON_BRIDGE_CONNS = [
  '      .avmm_read_i       (avmm_read_i),',
  '      .avmm_write_i      (avmm_write_i),',
  '      .avmm_address_i    (avmm_address_i),',
  '      .avmm_byteenable_i (avmm_byteenable_i),',
  '      .avmm_writedata_i  (avmm_writedata_i),',
  '      .avmm_waitrequest_o(avmm_waitrequest_o),',
  '      .avmm_response_o   (avmm_response_o),',
  '      .avmm_readdata_o   (avmm_readdata_o),',
]

const AXI_SLAVE_PORTS = [
  '    // AXI4-Lite slave interface',
  '    input  wire [ADDR_WIDTH-1:0] s_axi_awaddr_i,',
  '    input  wire [2:0]            s_axi_awprot_i,',
  '    input  wire                  s_axi_awvalid_i,',
  '    output wire                  s_axi_awready_o,',
  '    input  wire [DATA_WIDTH-1:0] s_axi_wdata_i,',
  '    input  wire [(DATA_WIDTH/8)-1:0] s_axi_wstrb_i,',
  '    input  wire                  s_axi_wvalid_i,',
  '    output wire                  s_axi_wready_o,',
  '    output wire [1:0]            s_axi_bresp_o,',
  '    output wire                  s_axi_bvalid_o,',
  '    input  wire                  s_axi_bready_i,',
  '    input  wire [ADDR_WIDTH-1:0] s_axi_araddr_i,',
  '    input  wire [2:0]            s_axi_arprot_i,',
  '    input  wire                  s_axi_arvalid_i,',
  '    output wire                  s_axi_arready_o,',
  '    output wire [DATA_WIDTH-1:0] s_axi_rdata_o,',
  '    output wire [1:0]            s_axi_rresp_o,',
  '    output wire                  s_axi_rvalid_o,',
  '    input  wire                  s_axi_rready_i,',
]

const AXI_BRIDGE_CONNS = [
  '      .s_axi_awaddr_i    (s_axi_awaddr_i),',
  '      .s_axi_awprot_i    (s_axi_awprot_i),',
  '      .s_axi_awvalid_i   (s_axi_awvalid_i),',
  '      .s_axi_awready_o   (s_axi_awready_o),',
  '      .s_axi_wdata_i     (s_axi_wdata_i),',
  '      .s_axi_wstrb_i     (s_axi_wstrb_i),',
  '      .s_axi_wvalid_i    (s_axi_wvalid_i),',
  '      .s_axi_wready_o    (s_axi_wready_o),',
  '      .s_axi_bresp_o     (s_axi_bresp_o),',
  '      .s_axi_bvalid_o    (s_axi_bvalid_o),',
  '      .s_axi_bready_i    (s_axi_bready_i),',
  '      .s_axi_araddr_i    (s_axi_araddr_i),',
  '      .s_axi_arprot_i    (s_axi_arprot_i),',
  '      .s_axi_arvalid_i   (s_axi_arvalid_i),',
  '      .s_axi_arready_o   (s_axi_arready_o),',
  '      .s_axi_rdata_o     (s_axi_rdata_o),',
  '      .s_axi_rresp_o     (s_axi_rresp_o),',
  '      .s_axi_rvalid_o    (s_axi_rvalid_o),',
  '      .s_axi_rready_i    (s_axi_rready_i),',
]

const BRIDGE_INFO = {
  [AVALON_MM_INTERFACE]: {
    label: 'Avalon-MM',
    module: 'csr_avalon_bridge',
    fileName: 'csr_avalon_bridge.sv',
    slavePorts: AVALON_SLAVE_PORTS,
    bridgeConns: AVALON_BRIDGE_CONNS,
    render: renderAvalonBridge,
  },
  [AXI4_LITE_INTERFACE]: {
    label: 'AXI4-Lite',
    module: 'csr_axi4lite_bridge',
    fileName: 'csr_axi4lite_bridge.sv',
    slavePorts: AXI_SLAVE_PORTS,
    bridgeConns: AXI_BRIDGE_CONNS,
    render: renderAxiLiteBridge,
  },
}

const renderCsrTop = ({ addrWidth, dataWidth, regs, moduleName, blockModuleName, bridge }) => {
  const { outputs, inputs } = collectPorts(regs)
  const fieldDecls = [...outputs, ...inputs].map((port) => declLine(port, false))

  const lines = [
    `// Top-level module that connects a single ${bridge.label} bridge to the native CSR block.`,
    `module ${moduleName} #(`,
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}`,
    ') (',
    '    input  wire                  clk_i,',
    '    input  wire                  rstn_i,',
    ...bridge.slavePorts,
  ]

  if (fieldDecls.length > 0) {
    lines.push('    // Native CSR connections')
    lines.push(...commaJoin(fieldDecls))
  } else {
    // Drop the trailing comma left by the slave port block.
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
  }

  lines.push(');', '', '  wire                  native_wr_en;')
  lines.push('  wire                  native_rd_en;')
  lines.push('  wire [ADDR_WIDTH-1:0] native_addr;')
  lines.push('  wire [(DATA_WIDTH/8)-1:0] native_be;')
  lines.push('  wire [DATA_WIDTH-1:0] native_wdata;')
  lines.push('  wire [DATA_WIDTH-1:0] native_rdata;', '')
  lines.push(`  ${bridge.module} #(`)
  lines.push('      .ADDR_WIDTH(ADDR_WIDTH),')
  lines.push('      .DATA_WIDTH(DATA_WIDTH)')
  lines.push('  ) u_bridge (')
  lines.push('      .clk_i             (clk_i),')
  lines.push('      .rstn_i            (rstn_i),')
  lines.push(...bridge.bridgeConns)
  lines.push('      .native_wr_en_o    (native_wr_en),')
  lines.push('      .native_rd_en_o    (native_rd_en),')
  lines.push('      .native_addr_o     (native_addr),')
  lines.push('      .native_be_o       (native_be),')
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
  lines.push('      .csr_be_i              (native_be),')
  lines.push('      .csr_wdata_i           (native_wdata),')
  lines.push('      .csr_rdata_o           (native_rdata),')

  const signalLines = [...outputs, ...inputs].map(
    (port) => `      .${port.name}${' '.repeat(Math.max(1, 23 - port.name.length))}(${port.name})`
  )

  if (signalLines.length > 0) {
    lines.push(...commaJoin(signalLines))
  } else {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '')
  }

  lines.push('  );', '', 'endmodule', '')

  return lines.join('\n')
}

export const generateRtlFiles = (doc) => {
  const model = buildRegisterModel(doc?.params, doc?.registers)
  const bridge = BRIDGE_INFO[model.interface]
  const blockModuleName = bridge ? `${model.moduleName}_csr` : model.moduleName

  const files = [
    {
      name: bridge ? `${model.moduleName}_csr.sv` : `${model.moduleName}.sv`,
      content: renderCsrBlock({
        ...model,
        blockModuleName,
      }),
    },
  ]

  if (bridge) {
    files.push(
      {
        name: bridge.fileName,
        content: bridge.render(model),
      },
      {
        name: `${model.moduleName}.sv`,
        content: renderCsrTop({
          ...model,
          blockModuleName,
          bridge,
        }),
      }
    )
  }

  return files
}

export const supportedInterfaces = [NATIVE_INTERFACE, AVALON_MM_INTERFACE, AXI4_LITE_INTERFACE]
export const supportedAccessTypes = ACCESS_TYPES
