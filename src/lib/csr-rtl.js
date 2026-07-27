import { accessTypeMap, accessTypeValues } from './access-types.js'

const NATIVE_INTERFACE = 'Native'
const AVALON_MM_INTERFACE = 'AvalonMM'

// Cycles a W1SC field stays asserted before it clears itself, and the width of
// the counter that times it.
const HOLD_CYCLES = 15
const HOLD_COUNTER_WIDTH = 8

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
const zeroLiteral = (width) => (width === 1 ? "1'b0" : `{${width}{1'b0}}`)
const reduceOr = (expr, width) => (width === 1 ? expr : `|${expr}`)
const pad = (text, size) => text + ' '.repeat(Math.max(1, size - text.length))
const hexAddr = (addr) => `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`
// A port is normally as wide as its field, but a field with `portWidth` is fed
// by a parameter-width vector and only its low bits land in the register.
const portWidthDecl = (port) =>
  port.widthExpr ? `[${port.widthExpr}-1:0] ` : widthDecl(port.width)
const widthColumnSize = (ports) =>
  Math.max(0, ...ports.map((port) => portWidthDecl(port).length))
const arrayDimSuffix = (port) => (port.arrayDim ? ` [${port.arrayDim}]` : '')
const moduleNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_PARAMETERS = ['ADDR_WIDTH', 'DATA_WIDTH']


// Fields that are stored by the shared write case block. W1C/W0C/W1SC own their
// own always block because their update rule is not a plain wdata capture.
const isStored = (access) => ['RW', 'WO', 'W1P'].includes(access)
const isSticky = (access) => ['W1C', 'W0C'].includes(access)

const readbackSignal = (field) => {
  const meta = accessTypeMap[field.access]
  if (!meta?.readable) {
    return null
  }
  return field.access === 'RO' ? `${field.sig}_i` : `${field.sig}_o`
}

/**
 * Pick a port base name per field, dropping the stutter when the register name
 * already ends with the field name: `DRAIN_PTR.drain_ptr` becomes `drain_ptr`
 * and `LANE_DMA_ADDR_LOW.addr_low` becomes `lane_dma_addr_low`. Falls back to
 * the fully prefixed name whenever the short form is not unique.
 */
const resolveSignalNames = (regs) => {
  const shortCounts = new Map()

  for (const reg of regs) {
    for (const field of reg.fields) {
      field.fullSig = `${reg.prefix}_${field.signalBase}`
      field.shortSig =
        reg.prefix === field.signalBase ||
        reg.prefix.endsWith(`_${field.signalBase}`)
          ? reg.prefix
          : field.fullSig
      shortCounts.set(field.shortSig, (shortCounts.get(field.shortSig) ?? 0) + 1)
    }
  }

  const used = new Set()

  for (const reg of regs) {
    for (const field of reg.fields) {
      const sig =
        shortCounts.get(field.shortSig) === 1 ? field.shortSig : field.fullSig

      if (used.has(sig)) {
        throw new Error(
          `${reg.name}.${field.name}: generated port name '${sig}' collides with another field`
        )
      }

      used.add(sig)
      field.sig = sig
    }
  }
}

const collectPorts = (regs) => {
  const outputs = []
  const inputs = []

  for (const reg of regs) {
    const arrayDim = reg.array ? reg.array.countExpr : null

    for (const field of reg.fields) {
      const meta = accessTypeMap[field.access]
      const label = `${reg.name}${reg.array ? '[]' : ''}.${field.name} (${field.access})`

      if (meta.port === 'in') {
        inputs.push({
          name: `${field.sig}_i`,
          dir: 'input',
          width: field.width,
          widthExpr: field.portWidth?.expr ?? null,
          arrayDim,
          comment: field.portWidth
            ? `${label}, low ${field.width} bits of the vector`
            : label,
        })
        continue
      }

      outputs.push({
        name: `${field.sig}_o`,
        dir: 'output',
        width: field.width,
        arrayDim,
        comment: label,
      })

      if (meta.port === 'out+set') {
        inputs.push({
          name: `${field.sig}_set_i`,
          dir: 'input',
          width: field.width,
          arrayDim,
          comment: `${label} hardware set strobe`,
        })
      }
    }
  }

  return { outputs, inputs }
}

/** Largest array a single register may expand to when checking address overlap. */
const MAX_ARRAY_INSTANCES = 1024

const buildParameters = (declared) => {
  if (declared == null) {
    return []
  }

  if (!Array.isArray(declared)) {
    throw new Error('params.parameters must be an array')
  }

  const seen = new Set()

  return declared.map((entry) => {
    const name = String(entry?.name ?? '').trim()

    if (!moduleNamePattern.test(name)) {
      throw new Error(`Invalid parameter name '${name}'`)
    }

    if (RESERVED_PARAMETERS.includes(name.toUpperCase())) {
      throw new Error(`Parameter '${name}' is reserved by the generator`)
    }

    if (seen.has(name)) {
      throw new Error(`Duplicate parameter '${name}'`)
    }
    seen.add(name)

    const value = Number(entry?.value ?? 0)

    if (!Number.isInteger(value)) {
      throw new Error(`Parameter '${name}': value must be an integer`)
    }

    return {
      name,
      value,
      description: String(entry?.description ?? '').trim(),
    }
  })
}

/**
 * Resolve a register's optional `array` block: `count` is either a literal or
 * the name of a declared parameter, `stride` is in bytes, and instances run
 * from `firstIndex` up to (but not including) the count.
 */
const buildArray = (spec, { reg, parameters, step }) => {
  if (spec == null) {
    return null
  }

  const rawCount = spec.count
  let countExpr
  let count
  let isLiteral = false

  if (typeof rawCount === 'number' || /^\d+$/.test(String(rawCount ?? '').trim())) {
    count = Number(rawCount)
    countExpr = String(count)
    isLiteral = true

    if (!Number.isInteger(count) || count <= 0) {
      throw new Error(`${reg.name}: array count must be a positive integer`)
    }
  } else {
    const name = String(rawCount ?? '').trim()
    const parameter = parameters.find((entry) => entry.name === name)

    if (!parameter) {
      throw new Error(
        `${reg.name}: array count '${name}' is not a declared parameter`
      )
    }

    countExpr = parameter.name
    count = parameter.value
  }

  const firstIndex = Number(spec.firstIndex ?? 0)
  const stride = Number(spec.stride ?? step)

  if (!Number.isInteger(firstIndex) || firstIndex < 0) {
    throw new Error(`${reg.name}: array firstIndex must be a non-negative integer`)
  }

  if (!Number.isInteger(stride) || stride < step || stride % step !== 0) {
    throw new Error(
      `${reg.name}: array stride ${stride} must be a positive multiple of ${step}`
    )
  }

  // A parameter count may legitimately leave the bank empty (NUM_LANES=1 with
  // firstIndex 1 means "no extra lanes"), but a literal that does is a typo.
  if (isLiteral && firstIndex >= count) {
    throw new Error(
      `${reg.name}: array firstIndex ${firstIndex} leaves no instances at count ${count}`
    )
  }

  if (count - firstIndex > MAX_ARRAY_INSTANCES) {
    throw new Error(
      `${reg.name}: array expands to ${count - firstIndex} instances; lower the count (limit ${MAX_ARRAY_INSTANCES})`
    )
  }

  return { countExpr, count, firstIndex, stride }
}

/**
 * Resolve a field's optional `portWidth`: the input port becomes a vector sized
 * by a parameter (or literal) while the field still occupies a fixed bit range,
 * so readback copies however many bits both sides have.
 */
const buildPortWidth = (spec, { reg, field, parameters }) => {
  if (spec == null || spec === '') {
    return null
  }

  if (field.access !== 'RO') {
    throw new Error(
      `${reg.name}.${field.name}: portWidth is only supported on RO fields`
    )
  }

  if (reg.array) {
    throw new Error(
      `${reg.name}.${field.name}: portWidth cannot be combined with a register array`
    )
  }

  if (typeof spec === 'number' || /^\d+$/.test(String(spec).trim())) {
    const literal = Number(spec)

    if (!Number.isInteger(literal) || literal <= 0) {
      throw new Error(`${reg.name}.${field.name}: portWidth must be positive`)
    }

    return { expr: String(literal) }
  }

  const name = String(spec).trim()
  const parameter = parameters.find((entry) => entry.name === name)

  if (!parameter) {
    throw new Error(
      `${reg.name}.${field.name}: portWidth '${name}' is not a declared parameter`
    )
  }

  return { expr: parameter.name }
}

/** Byte addresses a register occupies, worst case for arrays. */
const registerFootprint = (reg) => {
  if (!reg.array) {
    return [{ addr: reg.addr, index: null }]
  }

  const { firstIndex, count, stride } = reg.array
  const addresses = []

  for (let index = firstIndex; index < count; index += 1) {
    addresses.push({ addr: reg.addr + (index - firstIndex) * stride, index })
  }

  return addresses
}

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

  const parameters = buildParameters(params.parameters)

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
        portWidthSpec: field?.portWidth ?? null,
      }
    })

    const name = String(register?.name ?? `REG_${addrText}`)
    const constName = sanitizeConst(name)
    const prefix = sanitizeName(name)
    const entry = {
      addr: Number(addrText),
      name,
      constName,
      prefix,
      fields,
    }

    entry.array = buildArray(register?.array, {
      reg: entry,
      parameters,
      step,
    })

    return entry
  })

  regs.sort((a, b) => a.addr - b.addr)

  // Address -> what already claims it. An array claims every address it reaches
  // at its configured count, so an interleaved bank that runs into a later
  // register is caught here instead of at synthesis.
  const claimedAddrs = new Map()
  const seenNames = new Set()

  for (const reg of regs) {
    if (!Number.isInteger(reg.addr)) {
      throw new Error(`Invalid register address '${reg.addr}'`)
    }

    if (seenNames.has(reg.name)) {
      throw new Error(`Duplicate register name '${reg.name}'`)
    }
    seenNames.add(reg.name)

    if (reg.addr % step !== 0) {
      throw new Error(`Register ${reg.name} address ${reg.addr} must be ${step}-byte aligned`)
    }

    for (const { addr, index } of registerFootprint(reg)) {
      const label =
        index == null
          ? reg.name
          : `${reg.name}[${index}] (${reg.array.countExpr} = ${reg.array.count})`

      if (addr < 0 || addr >= 2 ** addrWidth) {
        throw new Error(
          `Register ${label} address ${hexAddr(addr)} is out of addrWidth range`
        )
      }

      const owner = claimedAddrs.get(addr)
      if (owner) {
        throw new Error(
          `Register ${label} overlaps ${owner} at address ${hexAddr(addr)}`
        )
      }

      claimedAddrs.set(addr, label)
    }

    const usedBits = new Set()

    for (const field of reg.fields) {
      if (!Number.isInteger(field.msb) || !Number.isInteger(field.lsb)) {
        throw new Error(`${reg.name}.${field.name}: invalid bitRange`)
      }

      if (!accessTypeValues.includes(field.access)) {
        throw new Error(
          `${reg.name}.${field.name}: unsupported access '${field.access}' (expected one of ${accessTypeValues.join(', ')})`
        )
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

      if (['W1P', 'W1SC'].includes(field.access) && field.reset !== 0) {
        throw new Error(
          `${reg.name}.${field.name}: ${field.access} fields are self-clearing and need resetValue 0`
        )
      }

      field.portWidth = buildPortWidth(field.portWidthSpec, {
        reg,
        field,
        parameters,
      })

      for (let bit = field.lsb; bit <= field.msb; bit += 1) {
        if (usedBits.has(bit)) {
          throw new Error(`${reg.name}: overlapping field bit ${bit}`)
        }
        usedBits.add(bit)
      }
    }
  }

  resolveSignalNames(regs)

  return {
    addrWidth,
    dataWidth,
    interface: csrInterface,
    moduleName,
    parameters,
    regs,
    ports: collectPorts(regs),
  }
}

/**
 * Emit grouped port declarations, commas on every entry but the very last one
 * across all groups.
 */
const renderPortGroups = (lines, groups, declare) => {
  const entries = groups.flatMap((group) => group.entries)
  const decls = new Map(entries.map((entry) => [entry, declare(entry)]))
  const commentColumn =
    Math.max(0, ...entries.map((entry) => decls.get(entry).length)) + 2

  let emitted = 0

  for (const group of groups) {
    if (group.entries.length === 0) {
      continue
    }

    lines.push('', `    // ${group.title}`)

    for (const entry of group.entries) {
      emitted += 1
      const decl = `${decls.get(entry)}${emitted === entries.length ? '' : ','}`
      lines.push(
        `    ${entry.comment ? `${pad(decl, commentColumn)}// ${entry.comment}` : decl}`
      )
    }
  }
}

/** Loop variable used by every generated register-array loop. */
const ARRAY_INDEX = 'L'

const renderParameterDecls = (parameters) =>
  parameters.flatMap((parameter, index) => [
    ...(parameter.description ? [`    // ${parameter.description}`] : []),
    `    parameter ${parameter.name} = ${parameter.value}${index < parameters.length - 1 ? ',' : ''}`,
  ])

/** W1C/W0C sticky bits: hardware sets, the host clears by writing 1 (or 0). */
const renderStickyBlock = (lines, reg, field) => {
  const sig = field.sig
  const wdata = `csr_wdata_i${bitSel(field.msb, field.lsb)}`
  const clrExpr = field.access === 'W1C' ? wdata : `~${wdata}`
  const header = [
    '',
    `  // ${reg.name}${reg.array ? '[]' : ''}.${field.name} (${field.access}): set by hardware strobe ${sig}_set_i;`,
    `  // the host clears it by writing ${field.access === 'W1C' ? '1' : '0'} to ${reg.name}${bitSel(field.msb, field.lsb)}.`,
  ]

  if (reg.array) {
    const element = `${sig}_o[${ARRAY_INDEX}]`
    // Bits the host leaves alone on a write: the inverse of the clear mask.
    const keepExpr = field.access === 'W1C' ? `~${wdata}` : wdata

    lines.push(
      ...header,
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
      `        ${element} <= ${resetLiteral(field.width, field.reset)};`,
      '      end',
      '    end else begin',
      '      // Clear before set so an event coincident with a host clear is not lost.',
      `      ${arrayLoopHeader(reg)} begin`,
      `        if (csr_wr_en_i && csr_addr_i == ${arrayAddrExpr(reg)}) begin`,
      `          ${element} <= (${element} & ${keepExpr}) | ${sig}_set_i[${ARRAY_INDEX}];`,
      '        end else begin',
      `          ${element} <= ${element} | ${sig}_set_i[${ARRAY_INDEX}];`,
      '        end',
      '      end',
      '    end',
      '  end'
    )
    return
  }

  lines.push(
    ...header,
    `  wire ${widthDecl(field.width)}${sig}_clr_w = (csr_wr_en_i && csr_addr_i == ${reg.constName}_ADDR) ?`,
    `      ${clrExpr} : ${zeroLiteral(field.width)};`,
    '',
    '  always @(posedge clk_i or negedge rstn_i) begin',
    '    if (!rstn_i) begin',
    `      ${sig}_o <= ${resetLiteral(field.width, field.reset)};`,
    '    end else begin',
    '      // Clear before set so an event coincident with a host clear is not lost.',
    `      ${sig}_o <= (${sig}_o & ~${sig}_clr_w) | ${sig}_set_i;`,
    '    end',
    '  end'
  )
}

/** W1SC: a host write-1 asserts the output for a hold window, then it clears. */
const renderSelfClearingBlock = (lines, reg, field) => {
  const sig = field.sig
  const cnt = `${sig}_hold_cnt`
  const holdConst = `${sanitizeConst(sig)}_HOLD_CYCLES`
  const wdata = `csr_wdata_i${bitSel(field.msb, field.lsb)}`
  const cntWidth = HOLD_COUNTER_WIDTH
  const namePad = Math.max(`${sig}_o`.length, cnt.length) + 1

  if (reg.array) {
    const element = `${sig}_o[${ARRAY_INDEX}]`
    const counter = `${cnt}[${ARRAY_INDEX}]`

    lines.push(
      '',
      `  // ${reg.name}[].${field.name} (W1SC): a host write-1 asserts that instance's output,`,
      `  // which stays asserted for ${holdConst} clocks and then clears itself.`,
      `  localparam [${cntWidth - 1}:0] ${holdConst} = ${resetLiteral(cntWidth, HOLD_CYCLES)};`,
      '',
      `  reg [${cntWidth - 1}:0] ${cnt} [${reg.array.countExpr}];`,
      '',
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
      `        ${element} <= ${zeroLiteral(field.width)};`,
      `        ${counter} <= ${resetLiteral(cntWidth, 0)};`,
      '      end',
      '    end else begin',
      `      ${arrayLoopHeader(reg)} begin`,
      `        if (csr_wr_en_i && (csr_addr_i == ${arrayAddrExpr(reg)}) &&`,
      `            ${reduceOr(wdata, field.width)}) begin`,
      `          ${element} <= ${wdata};`,
      `          ${counter} <= ${holdConst};`,
      `        end else if (${counter} != ${resetLiteral(cntWidth, 0)}) begin`,
      `          ${counter} <= ${counter} - ${resetLiteral(cntWidth, 1)};`,
      `          if (${counter} == ${resetLiteral(cntWidth, 1)}) ${element} <= ${zeroLiteral(field.width)};`,
      '        end',
      '      end',
      '    end',
      '  end'
    )
    return
  }

  lines.push(
    '',
    `  // ${reg.name}.${field.name} (W1SC): a host write-1 asserts the output, which stays`,
    `  // asserted for ${holdConst} clocks and then clears itself.`,
    `  localparam [${cntWidth - 1}:0] ${holdConst} = ${resetLiteral(cntWidth, HOLD_CYCLES)};`,
    '',
    `  reg [${cntWidth - 1}:0] ${cnt};`,
    `  wire ${sig}_set_w = csr_wr_en_i && (csr_addr_i == ${reg.constName}_ADDR) &&`,
    `      ${reduceOr(wdata, field.width)};`,
    '',
    '  always @(posedge clk_i or negedge rstn_i) begin',
    '    if (!rstn_i) begin',
    `      ${pad(`${sig}_o`, namePad)}<= ${zeroLiteral(field.width)};`,
    `      ${pad(cnt, namePad)}<= ${resetLiteral(cntWidth, 0)};`,
    `    end else if (${sig}_set_w) begin`,
    `      ${pad(`${sig}_o`, namePad)}<= ${wdata};`,
    `      ${pad(cnt, namePad)}<= ${holdConst};`,
    `    end else if (${cnt} != ${resetLiteral(cntWidth, 0)}) begin`,
    `      ${pad(cnt, namePad)}<= ${cnt} - ${resetLiteral(cntWidth, 1)};`,
    `      if (${cnt} == ${resetLiteral(cntWidth, 1)}) ${sig}_o <= ${zeroLiteral(field.width)};`,
    '    end',
    '  end'
  )
}

/** `for (int L = first; L < COUNT; L++)` over an arrayed register's instances. */
const arrayLoopHeader = (reg, { fromZero = false } = {}) =>
  `for (int ${ARRAY_INDEX} = ${fromZero ? 0 : reg.array.firstIndex}; ${ARRAY_INDEX} < ${reg.array.countExpr}; ${ARRAY_INDEX}++)`

/** Address of instance L: base + (L - first) * stride. */
const arrayAddrExpr = (reg) => {
  const offset =
    reg.array.firstIndex === 0
      ? ARRAY_INDEX
      : `(${ARRAY_INDEX} - ${reg.array.firstIndex})`

  return `ADDR_WIDTH'(${reg.constName}_BASE + ${offset} * ${reg.constName}_STRIDE)`
}

const renderCsrBlock = ({
  addrWidth,
  dataWidth,
  parameters,
  regs,
  ports,
  blockModuleName,
}) => {
  const { outputs, inputs } = ports
  const scalarRegs = regs.filter((reg) => !reg.array)
  const arrayRegs = regs.filter((reg) => reg.array)
  const storedFields = []
  const pulseFields = []

  for (const reg of scalarRegs) {
    for (const field of reg.fields) {
      if (isStored(field.access)) {
        storedFields.push({ reg, field })
      }
      if (field.access === 'W1P') {
        pulseFields.push({ reg, field })
      }
    }
  }

  const storedArrayRegs = arrayRegs.filter((reg) =>
    reg.fields.some((field) => isStored(field.access))
  )

  const lines = [
    `module ${blockModuleName} #(`,
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}${parameters.length > 0 ? ',' : ''}`,
    ...renderParameterDecls(parameters),
    ') (',
    '    input  wire                  clk_i,',
    '    input  wire                  rstn_i,',
    '    input  wire                  csr_wr_en_i,',
    '    input  wire                  csr_rd_en_i,',
    '    input  wire [ADDR_WIDTH-1:0] csr_addr_i,',
    '    input  wire [DATA_WIDTH-1:0] csr_wdata_i,',
    `    output reg  [DATA_WIDTH-1:0] csr_rdata_o${outputs.length || inputs.length ? ',' : ''}`,
  ]

  const widthColumn = widthColumnSize([...outputs, ...inputs])

  renderPortGroups(
    lines,
    [
      { title: 'Register field outputs', entries: outputs },
      { title: 'Register field inputs', entries: inputs },
    ],
    (port) =>
      `${port.dir === 'output' ? 'output reg ' : 'input  wire'} ${portWidthDecl(port).padEnd(widthColumn)}${port.name}${arrayDimSuffix(port)}`
  )

  lines.push(');', '')

  for (const reg of scalarRegs) {
    lines.push(`  localparam [ADDR_WIDTH-1:0] ${reg.constName}_ADDR = ADDR_WIDTH'(${reg.addr});`)
  }

  for (const reg of arrayRegs) {
    const instances =
      reg.array.firstIndex === 0
        ? reg.array.countExpr
        : `${reg.array.countExpr} - ${reg.array.firstIndex}`

    lines.push(
      '',
      `  // ${reg.name}: ${instances} instances at index ${reg.array.firstIndex}..${reg.array.countExpr}-1,`,
      `  // ${reg.array.stride}-byte stride from ${hexAddr(reg.addr)}.`,
      `  localparam int ${reg.constName}_BASE   = ${reg.addr};`,
      `  localparam int ${reg.constName}_STRIDE = ${reg.array.stride};`
    )
  }

  for (const reg of regs) {
    for (const field of reg.fields) {
      if (isSticky(field.access)) {
        renderStickyBlock(lines, reg, field)
      } else if (field.access === 'W1SC') {
        renderSelfClearingBlock(lines, reg, field)
      }
    }
  }

  if (storedFields.length > 0 || storedArrayRegs.length > 0) {
    lines.push('', '  // CSR write handling', '  always @(posedge clk_i or negedge rstn_i) begin')
    lines.push('    if (!rstn_i) begin')

    for (const { field } of storedFields) {
      lines.push(`      ${field.sig}_o <= ${resetLiteral(field.width, field.reset)};`)
    }

    for (const reg of storedArrayRegs) {
      // Reset every instance, including any below firstIndex, so unused
      // entries are still driven.
      lines.push(`      ${arrayLoopHeader(reg, { fromZero: true })} begin`)
      for (const field of reg.fields.filter((entry) => isStored(entry.access))) {
        lines.push(
          `        ${field.sig}_o[${ARRAY_INDEX}] <= ${resetLiteral(field.width, field.reset)};`
        )
      }
      lines.push('      end')
    }

    lines.push('    end else begin')

    const pulseArrayRegs = arrayRegs.filter((reg) =>
      reg.fields.some((field) => field.access === 'W1P')
    )

    if (pulseFields.length > 0 || pulseArrayRegs.length > 0) {
      lines.push('      // Write-1 pulses are single cycle: default them low every clock.')

      for (const { field } of pulseFields) {
        lines.push(`      ${field.sig}_o <= ${zeroLiteral(field.width)};`)
      }

      for (const reg of pulseArrayRegs) {
        lines.push(`      ${arrayLoopHeader(reg, { fromZero: true })} begin`)
        for (const field of reg.fields.filter((entry) => entry.access === 'W1P')) {
          lines.push(
            `        ${field.sig}_o[${ARRAY_INDEX}] <= ${zeroLiteral(field.width)};`
          )
        }
        lines.push('      end')
      }

      lines.push('')
    }

    lines.push('      if (csr_wr_en_i) begin')

    for (const reg of storedArrayRegs) {
      lines.push(
        `        // ${reg.name}: decode one instance per index.`,
        `        ${arrayLoopHeader(reg)} begin`,
        `          if (csr_addr_i == ${arrayAddrExpr(reg)}) begin`
      )
      for (const field of reg.fields.filter((entry) => isStored(entry.access))) {
        lines.push(
          `            ${field.sig}_o[${ARRAY_INDEX}] <= csr_wdata_i${bitSel(field.msb, field.lsb)};`
        )
      }
      lines.push('          end', '        end', '')
    }

    lines.push('        case (csr_addr_i)')

    for (const reg of scalarRegs) {
      const written = reg.fields.filter((field) => isStored(field.access))
      if (written.length === 0) {
        continue
      }

      lines.push(`          ${reg.constName}_ADDR: begin`)
      for (const field of written) {
        lines.push(
          `            ${field.sig}_o <= csr_wdata_i${bitSel(field.msb, field.lsb)};`
        )
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
      '  end'
    )
  }

  lines.push(
    '',
    '  // Readback path',
    '  always @(*) begin',
    '    csr_rdata_o = {DATA_WIDTH{1\'b0}};',
    '',
    '    if (csr_rd_en_i) begin',
    '      case (csr_addr_i)'
  )

  for (const reg of scalarRegs) {
    const readable = reg.fields.filter((field) => readbackSignal(field))
    if (readable.length === 0) {
      continue
    }

    lines.push(`        ${reg.constName}_ADDR: begin`)
    for (const field of readable) {
      if (field.portWidth) {
        // Vector port: copy as many bits as both the port and the field have.
        const bit =
          field.lsb === 0 ? ARRAY_INDEX : `${field.lsb} + ${ARRAY_INDEX}`

        lines.push(
          `          for (int ${ARRAY_INDEX} = 0; ${ARRAY_INDEX} < ${field.portWidth.expr} && ${ARRAY_INDEX} < ${field.width}; ${ARRAY_INDEX}++) begin`,
          `            csr_rdata_o[${bit}] = ${readbackSignal(field)}[${ARRAY_INDEX}];`,
          '          end'
        )
        continue
      }

      lines.push(
        `          csr_rdata_o${bitSel(field.msb, field.lsb)} = ${readbackSignal(field)};`
      )
    }
    lines.push('        end')
  }

  lines.push(
    '        default: begin',
    '          csr_rdata_o = {DATA_WIDTH{1\'b0}};',
    '        end',
    '      endcase'
  )

  for (const reg of arrayRegs) {
    const readable = reg.fields.filter((field) => readbackSignal(field))
    if (readable.length === 0) {
      continue
    }

    lines.push(
      '',
      `      // ${reg.name}: instance readback, overrides the case default on a match.`,
      `      ${arrayLoopHeader(reg)} begin`,
      `        if (csr_addr_i == ${arrayAddrExpr(reg)}) begin`,
      '          csr_rdata_o = {DATA_WIDTH{1\'b0}};'
    )
    for (const field of readable) {
      lines.push(
        `          csr_rdata_o${bitSel(field.msb, field.lsb)} = ${readbackSignal(field)}[${ARRAY_INDEX}];`
      )
    }
    lines.push('        end', '      end')
  }

  lines.push('    end', '  end', '', 'endmodule', '')

  return lines.join('\n')
}

const renderAvalonBridge = ({ addrWidth, dataWidth }) => {
  const byteLanes = dataWidth / 8
  const byteMask = []

  for (let index = byteLanes - 1; index >= 0; index -= 1) {
    const suffix = index === 0 ? '' : ','
    byteMask.push(`        {8{avmm_byteenable_i[${index}]}}${suffix}`)
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

const renderCsrTop = ({
  addrWidth,
  dataWidth,
  parameters,
  ports,
  moduleName,
  blockModuleName,
}) => {
  const { outputs, inputs } = ports
  const allPorts = [...outputs, ...inputs]
  const widthColumn = widthColumnSize(allPorts)

  const lines = [
    '// Top-level module that connects a single Avalon-MM bridge to the native CSR block.',
    `module ${moduleName} #(`,
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}${parameters.length > 0 ? ',' : ''}`,
    ...renderParameterDecls(parameters),
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
    `    output wire [DATA_WIDTH-1:0] avmm_readdata_o${allPorts.length > 0 ? ',' : ''}`,
  ]

  renderPortGroups(
    lines,
    [{ title: 'Native CSR connections', entries: allPorts }],
    (port) =>
      `${port.dir === 'output' ? 'output' : 'input '} wire ${portWidthDecl(port).padEnd(widthColumn)}${port.name}${arrayDimSuffix(port)}`
  )

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

  const paramPad =
    Math.max(
      'ADDR_WIDTH'.length,
      ...parameters.map((parameter) => parameter.name.length)
    ) + 1
  const paramNames = ['ADDR_WIDTH', 'DATA_WIDTH', ...parameters.map((p) => p.name)]

  paramNames.forEach((name, index) => {
    const comma = index < paramNames.length - 1 ? ',' : ''
    lines.push(`      .${pad(name, paramPad)}(${name})${comma}`)
  })

  lines.push('  ) u_csr (')

  const busSignals = [
    ['clk_i', 'clk_i'],
    ['rstn_i', 'rstn_i'],
    ['csr_wr_en_i', 'native_wr_en'],
    ['csr_rd_en_i', 'native_rd_en'],
    ['csr_addr_i', 'native_addr'],
    ['csr_wdata_i', 'native_wdata'],
    ['csr_rdata_o', 'native_rdata'],
  ]

  const namePad =
    Math.max(
      ...busSignals.map(([name]) => name.length),
      ...allPorts.map((port) => port.name.length)
    ) + 1

  const connections = [
    ...busSignals.map(([name, net]) => `      .${pad(name, namePad)}(${net}),`),
    ...allPorts.map((port) => `      .${pad(port.name, namePad)}(${port.name}),`),
  ]

  connections[connections.length - 1] = connections[connections.length - 1].replace(/,$/, '')
  lines.push(...connections)

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
