import {
  accessTypeMap,
  accessTypeValues,
  holdCounterWidth,
  holdCyclesOf,
} from './access-types.js'

const NATIVE_INTERFACE = 'Native'
const AVALON_MM_INTERFACE = 'AvalonMM'
const AXI4_LITE_INTERFACE = 'AXI4Lite'

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
const constLiteral = (width, value) =>
  `${width}'h${value.toString(16).toUpperCase()}`
const zeroLiteral = (width) => (width === 1 ? "1'b0" : `{${width}{1'b0}}`)
const reduceOr = (expr, width) => (width === 1 ? expr : `|${expr}`)
const pad = (text, size) => text + ' '.repeat(Math.max(1, size - text.length))
const hexAddr = (addr) => `0x${addr.toString(16).toUpperCase().padStart(4, '0')}`
// A field is normally a fixed number of bits, but its width may instead be a
// parameter, in which case every reference to it stays symbolic.
const portWidthDecl = (port) =>
  port.widthExpr ? `[${port.widthExpr}-1:0] ` : widthDecl(port.width)
const widthColumnSize = (ports) =>
  Math.max(0, ...ports.map((port) => portWidthDecl(port).length))

/** `[15:8]`, or SystemVerilog's `[8 +: NUM_LANES]` for a parameter width. */
const fieldSel = (field) =>
  field.widthExpr
    ? `[${field.lsb} +: ${field.widthExpr}]`
    : bitSel(field.msb, field.lsb)
const fieldWidthDecl = (field) =>
  field.widthExpr ? `[${field.widthExpr}-1:0] ` : widthDecl(field.width)
const fieldZero = (field) =>
  field.widthExpr ? `{${field.widthExpr}{1'b0}}` : zeroLiteral(field.width)
const fieldReset = (field) =>
  field.widthExpr
    ? `${field.widthExpr}'(${field.reset})`
    : resetLiteral(field.width, field.reset)
const arrayDimSuffix = (port) => (port.arrayDim ? ` [${port.arrayDim}]` : '')
/** A named value sized to its field, symbolic when the width is a parameter. */
const enumLiteral = (field, value) =>
  field.widthExpr
    ? `${field.widthExpr}'(${value})`
    : resetLiteral(field.width, value)

/**
 * The bits of a field a write is allowed to touch, from the byte enables. A
 * lane the host did not enable contributes nothing, which is the no-op every
 * access type already defines: RW keeps its flop and the write-one-to-X types
 * see a 0. Masking here rather than reading back and merging in the bridge is
 * what stops a byte write from clobbering an untouched W1C status bit.
 */
const fieldMask = (field) => `csr_wr_mask${fieldSel(field)}`

/** The write data a field actually sees, with disabled byte lanes zeroed. */
const maskedWdata = (field) =>
  `(csr_wdata_i${fieldSel(field)} & ${fieldMask(field)})`

/** `{8{be[N]}}, ... {8{be[0]}}` - byte enables expanded to a per-bit mask. */
const byteMaskLines = (dataWidth, strobeName, indent) => {
  const lanes = []

  for (let index = dataWidth / 8 - 1; index >= 0; index -= 1) {
    lanes.push(`${indent}{8{${strobeName}[${index}]}}${index === 0 ? '' : ','}`)
  }

  return lanes
}
const moduleNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_PARAMETERS = ['ADDR_WIDTH', 'DATA_WIDTH']


// Fields that are stored by the shared write case block. W1C/W0C/W1SC own their
// own always block because their update rule is not a plain wdata capture.
const isStored = (access) => ['RW', 'WO', 'W1P'].includes(access)
const isSticky = (access) => ['W1C', 'W0C'].includes(access)

/**
 * The write assignment for a field the shared case block stores, masked so a
 * disabled byte lane is left as it was. A W1P pulse takes the masked data
 * straight, since it is re-defaulted to 0 every clock anyway.
 */
const storedUpdate = (field, index = null) => {
  const target = index == null ? `${field.sig}_o` : `${field.sig}_o[${index}]`

  if (field.access === 'W1P') {
    return `${target} <= ${maskedWdata(field)};`
  }

  return `${target} <= ${maskedWdata(field)} | (${target} & ~${fieldMask(field)});`
}

/**
 * Registers that need a write-strobe flop: those exposing one, and those whose
 * write advances a paired auto-incrementing address register. A register that
 * only drives an auto-increment keeps the flop internal.
 */
const needsStrobe = (reg) => reg.writeStrobe || reg.autoIncrementTargets.length > 0

const strobeSignal = (reg) =>
  reg.writeStrobe ? `${reg.prefix}_wr_o` : `${reg.prefix}_wr_q`

const readbackSignal = (field) => {
  const meta = accessTypeMap[field.access]
  if (!meta?.readable) {
    return null
  }

  if (field.access === 'RO') {
    // A constant reads back its own value; nothing drives it from outside.
    return field.constant ? constLiteral(field.width, field.reset) : `${field.sig}_i`
  }

  return `${field.sig}_o`
}

/** Right-hand side of a readback assignment, indexed for an arrayed register. */
const readbackExpr = (field, index = null) => {
  const signal = readbackSignal(field)

  if (signal == null) {
    return null
  }

  // A constant is a literal rather than a signal, so it takes no array index.
  if (field.access === 'RO' && field.constant) {
    return signal
  }

  return index == null ? signal : `${signal}[${index}]`
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
        // A constant field is tied off inside the block, so it has no port.
        if (field.constant) {
          continue
        }

        inputs.push({
          name: `${field.sig}_i`,
          dir: 'input',
          width: field.width,
          widthExpr: field.widthExpr,
          arrayDim,
          comment: label,
        })
        continue
      }

      outputs.push({
        name: `${field.sig}_o`,
        dir: 'output',
        width: field.width,
        widthExpr: field.widthExpr,
        arrayDim,
        comment: label,
      })

      if (meta.port === 'out+set') {
        inputs.push({
          name: `${field.sig}_set_i`,
          dir: 'input',
          width: field.width,
          widthExpr: field.widthExpr,
          arrayDim,
          comment: `${label} hardware set strobe`,
        })
      }

      if (meta.port === 'out+clr') {
        inputs.push({
          name: `${field.sig}_clr_i`,
          dir: 'input',
          width: field.width,
          widthExpr: field.widthExpr,
          arrayDim,
          comment: `${label} hardware clear request`,
        })
      }
    }

    // Driven straight from the write always block rather than through a shadow
    // register, so an arrayed strobe is one unpacked entry per instance.
    if (reg.writeStrobe) {
      outputs.push({
        name: `${reg.prefix}_wr_o`,
        dir: 'output',
        width: 1,
        widthExpr: null,
        arrayDim,
        comment: `${reg.name}${reg.array ? '[]' : ''} write strobe`,
      })
    }
  }

  return { outputs, inputs }
}

// Links each auto-incrementing register to the one whose write advances it, so
// the trigger's write arm can emit the increment.
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

    // Which instance of a bank the increment would apply to is undefined, so
    // both ends have to be plain registers.
    if (reg.array || trigger.array) {
      throw new Error(
        `${reg.name}: autoIncrementOn is not supported on register arrays`
      )
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

/**
 * Field ports are already unique by construction, but a write strobe is named
 * after its register and can land on a field's port name.
 */
const checkStrobeNames = (regs) => {
  const { outputs, inputs } = collectPorts(regs)
  const seen = new Set()

  for (const port of [...outputs, ...inputs]) {
    if (seen.has(port.name)) {
      throw new Error(`Duplicate RTL port name '${port.name}'`)
    }
    seen.add(port.name)
  }
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
 * A field's width is either fixed by its msb/lsb or given as `bitRange.width`,
 * a parameter name or literal. The parameterised form keeps the RTL symbolic
 * (`[8 +: NUM_LANES]`) while everything that needs a number uses the width the
 * parameter currently holds.
 */
const buildFieldWidth = (bitRange, { regName, fieldName, parameters }) => {
  const lsb = Number(bitRange?.lsb)
  const spec = bitRange?.width

  if (spec == null || spec === '') {
    const msb = Number(bitRange?.msb)
    return { lsb, msb, width: msb - lsb + 1, widthExpr: null }
  }

  if (typeof spec === 'number' || /^\d+$/.test(String(spec).trim())) {
    const width = Number(spec)

    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`${regName}.${fieldName}: bit width must be positive`)
    }

    return { lsb, msb: lsb + width - 1, width, widthExpr: null }
  }

  const name = String(spec).trim()
  const parameter = parameters.find((entry) => entry.name === name)

  if (!parameter) {
    throw new Error(
      `${regName}.${fieldName}: bit width '${name}' is not a declared parameter`
    )
  }

  return {
    lsb,
    msb: lsb + parameter.value - 1,
    width: parameter.value,
    widthExpr: parameter.name,
  }
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

  if (
    ![NATIVE_INTERFACE, AVALON_MM_INTERFACE, AXI4_LITE_INTERFACE].includes(
      csrInterface
    )
  ) {
    throw new Error(`Unsupported interface '${csrInterface}'`)
  }

  if (!moduleNamePattern.test(moduleName)) {
    throw new Error(`Invalid moduleName '${moduleName}'`)
  }

  const parameters = buildParameters(params.parameters)

  const regs = Object.entries(registerMap).map(([addrText, register]) => {
    const fields = (register?.fields ?? []).map((field) => {
      const fieldName = String(field?.name ?? '')

      return {
        name: fieldName,
        access: String(field?.type ?? '').toUpperCase(),
        reset: Number(field?.resetValue ?? 0),
        // An RO field whose value never changes: tied off in the block rather
        // than exposed as an input the caller has to drive.
        constant: Boolean(field?.constant),
        // Named values the field can hold, emitted as localparams so the RTL
        // can be read against the same names software uses.
        enumValues: (field?.enumValues ?? []).map((entry) => ({
          name: String(entry?.name ?? ''),
          constName: sanitizeConst(String(entry?.name ?? 'VALUE')),
          value: Number(entry?.value ?? 0),
        })),
        // Only meaningful for W1SC; validated below. Blank means "default",
        // which is what a cleared input submits before it has been blurred.
        holdCycles:
          field?.holdCycles == null || field.holdCycles === ''
            ? null
            : Number(field.holdCycles),
        signalBase: sanitizeName(fieldName),
        ...buildFieldWidth(field?.bitRange, {
          regName: String(register?.name ?? `REG_${addrText}`),
          fieldName,
          parameters,
        }),
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
      // Opt-in single-cycle output pulsed on a software write to this register.
      writeStrobe: Boolean(register?.writeStrobe),
      // Name of the register whose write auto-increments this one.
      autoIncrementOn:
        register?.autoIncrementOn == null
          ? null
          : String(register.autoIncrementOn),
      // Filled in by resolveAutoIncrement: registers this one advances.
      autoIncrementTargets: [],
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

      const seenValues = new Set()
      const seenCodes = new Set()

      for (const entry of field.enumValues) {
        if (seenValues.has(entry.constName)) {
          throw new Error(
            `${reg.name}.${field.name}: duplicate value name '${entry.name}'`
          )
        }
        seenValues.add(entry.constName)

        if (seenCodes.has(entry.value)) {
          throw new Error(
            `${reg.name}.${field.name}: '${entry.name}' repeats the code ${entry.value}`
          )
        }
        seenCodes.add(entry.value)

        if (
          !Number.isInteger(entry.value) ||
          entry.value < 0 ||
          entry.value > 2 ** field.width - 1
        ) {
          throw new Error(
            `${reg.name}.${field.name}: value ${entry.value} for '${entry.name}' does not fit ${field.width} bit(s)`
          )
        }
      }

      if (field.constant && field.access !== 'RO') {
        throw new Error(
          `${reg.name}.${field.name}: constant is only valid on RO fields, not '${field.access}'`
        )
      }

      if (field.holdCycles != null) {
        if (field.access !== 'W1SC') {
          throw new Error(
            `${reg.name}.${field.name}: holdCycles is only valid on W1SC fields, not '${field.access}'`
          )
        }

        if (!Number.isInteger(field.holdCycles) || field.holdCycles < 1) {
          throw new Error(
            `${reg.name}.${field.name}: holdCycles must be a positive integer`
          )
        }
      }

      if (['W1P', 'W1SC'].includes(field.access) && field.reset !== 0) {
        throw new Error(
          `${reg.name}.${field.name}: ${field.access} fields are self-clearing and need resetValue 0`
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

  resolveSignalNames(regs)
  resolveAutoIncrement(regs)
  checkStrobeNames(regs)

  return {
    addrWidth,
    dataWidth,
    interface: csrInterface,
    moduleName,
    parameters,
    registeredReadback,
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
  // Bits the host is clearing this cycle: the written pattern for W1C, its
  // inverse for W0C, and in both cases only where a byte lane is enabled.
  const clrExpr =
    field.access === 'W1C'
      ? maskedWdata(field)
      : `(~csr_wdata_i${fieldSel(field)} & ${fieldMask(field)})`
  const header = [
    '',
    `  // ${reg.name}${reg.array ? '[]' : ''}.${field.name} (${field.access}): set by hardware strobe ${sig}_set_i;`,
    `  // the host clears it by writing ${field.access === 'W1C' ? '1' : '0'} to ${reg.name}${fieldSel(field)}.`,
  ]

  if (reg.array) {
    const element = `${sig}_o[${ARRAY_INDEX}]`

    lines.push(
      ...header,
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
      `        ${element} <= ${fieldReset(field)};`,
      '      end',
      '    end else begin',
      '      // Clear before set so an event coincident with a host clear is not lost.',
      `      ${arrayLoopHeader(reg)} begin`,
      `        if (csr_wr_en_i && csr_addr_i == ${arrayAddrExpr(reg)}) begin`,
      `          ${element} <= (${element} & ~${clrExpr}) | ${sig}_set_i[${ARRAY_INDEX}];`,
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
    `  wire ${fieldWidthDecl(field)}${sig}_clr_w = (csr_wr_en_i && csr_addr_i == ${reg.constName}_ADDR) ?`,
    `      ${clrExpr} : ${fieldZero(field)};`,
    '',
    '  always @(posedge clk_i or negedge rstn_i) begin',
    '    if (!rstn_i) begin',
    `      ${sig}_o <= ${fieldReset(field)};`,
    '    end else begin',
    '      // Clear before set so an event coincident with a host clear is not lost.',
    `      ${sig}_o <= (${sig}_o & ~${sig}_clr_w) | ${sig}_set_i;`,
    '    end',
    '  end'
  )
}

/** W1S: the host sets bits by writing 1, and hardware clears them again. */
const renderSetBlock = (lines, reg, field) => {
  const sig = field.sig
  const setExpr = maskedWdata(field)
  const header = [
    '',
    `  // ${reg.name}${reg.array ? '[]' : ''}.${field.name} (W1S): the host sets a bit by writing 1;`,
    `  // hardware clears it again through ${sig}_clr_i.`,
  ]

  if (reg.array) {
    const element = `${sig}_o[${ARRAY_INDEX}]`

    lines.push(
      ...header,
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
      `        ${element} <= ${fieldReset(field)};`,
      '      end',
      '    end else begin',
      '      // Set after clear so a host set coincident with a clear still takes.',
      `      ${arrayLoopHeader(reg)} begin`,
      `        if (csr_wr_en_i && csr_addr_i == ${arrayAddrExpr(reg)}) begin`,
      `          ${element} <= (${element} & ~${sig}_clr_i[${ARRAY_INDEX}]) | ${setExpr};`,
      '        end else begin',
      `          ${element} <= ${element} & ~${sig}_clr_i[${ARRAY_INDEX}];`,
      '        end',
      '      end',
      '    end',
      '  end'
    )
    return
  }

  lines.push(
    ...header,
    `  wire ${fieldWidthDecl(field)}${sig}_set_w = (csr_wr_en_i && csr_addr_i == ${reg.constName}_ADDR) ?`,
    `      ${setExpr} : ${fieldZero(field)};`,
    '',
    '  always @(posedge clk_i or negedge rstn_i) begin',
    '    if (!rstn_i) begin',
    `      ${sig}_o <= ${fieldReset(field)};`,
    '    end else begin',
    '      // Set after clear so a host set coincident with a clear still takes.',
    `      ${sig}_o <= (${sig}_o & ~${sig}_clr_i) | ${sig}_set_w;`,
    '    end',
    '  end'
  )
}

/**
 * W1SC: a host write-1 asserts the output for the field's hold window, then it
 * clears. The counter is sized to the window rather than fixed, so a one-cycle
 * pulse costs one flop.
 */
const renderSelfClearingBlock = (lines, reg, field) => {
  const sig = field.sig
  const cnt = `${sig}_hold_cnt`
  const holdConst = `${sanitizeConst(sig)}_HOLD_CYCLES`
  const wdata = maskedWdata(field)
  const holdCycles = holdCyclesOf(field)
  const cntWidth = holdCounterWidth(holdCycles)
  const namePad = Math.max(`${sig}_o`.length, cnt.length) + 1

  if (reg.array) {
    const element = `${sig}_o[${ARRAY_INDEX}]`
    const counter = `${cnt}[${ARRAY_INDEX}]`

    lines.push(
      '',
      `  // ${reg.name}[].${field.name} (W1SC): a host write-1 asserts that instance's output,`,
      `  // which stays asserted for ${holdConst} (${holdCycles}) clocks and then clears itself.`,
      `  localparam [${cntWidth - 1}:0] ${holdConst} = ${resetLiteral(cntWidth, holdCycles)};`,
      '',
      `  reg [${cntWidth - 1}:0] ${cnt} [${reg.array.countExpr}];`,
      '',
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
      `        ${element} <= ${fieldZero(field)};`,
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
      `          if (${counter} == ${resetLiteral(cntWidth, 1)}) ${element} <= ${fieldZero(field)};`,
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
    `  // asserted for ${holdConst} (${holdCycles}) clocks and then clears itself.`,
    `  localparam [${cntWidth - 1}:0] ${holdConst} = ${resetLiteral(cntWidth, holdCycles)};`,
    '',
    `  reg [${cntWidth - 1}:0] ${cnt};`,
    `  wire ${sig}_set_w = csr_wr_en_i && (csr_addr_i == ${reg.constName}_ADDR) &&`,
    `      ${reduceOr(wdata, field.width)};`,
    '',
    '  always @(posedge clk_i or negedge rstn_i) begin',
    '    if (!rstn_i) begin',
    `      ${pad(`${sig}_o`, namePad)}<= ${fieldZero(field)};`,
    `      ${pad(cnt, namePad)}<= ${resetLiteral(cntWidth, 0)};`,
    `    end else if (${sig}_set_w) begin`,
    `      ${pad(`${sig}_o`, namePad)}<= ${wdata};`,
    `      ${pad(cnt, namePad)}<= ${holdConst};`,
    `    end else if (${cnt} != ${resetLiteral(cntWidth, 0)}) begin`,
    `      ${pad(cnt, namePad)}<= ${cnt} - ${resetLiteral(cntWidth, 1)};`,
    `      if (${cnt} == ${resetLiteral(cntWidth, 1)}) ${sig}_o <= ${fieldZero(field)};`,
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
  registeredReadback,
}) => {
  const { outputs, inputs } = ports
  const scalarRegs = regs.filter((reg) => !reg.array)
  const arrayRegs = regs.filter((reg) => reg.array)
  // The readback mux drives a flop instead of the port when it is registered.
  const readTarget = registeredReadback ? 'csr_rdata_next' : 'csr_rdata_o'
  const strobeRegs = regs.filter(needsStrobe)
  const scalarStrobeRegs = strobeRegs.filter((reg) => !reg.array)
  const arrayStrobeRegs = strobeRegs.filter((reg) => reg.array)
  const incRegs = regs.filter((reg) => reg.autoIncrementTargets.length > 0)
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

  const storedArrayRegs = arrayRegs.filter(
    (reg) => reg.fields.some((field) => isStored(field.access)) || needsStrobe(reg)
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
    '    input  wire [(DATA_WIDTH/8)-1:0] csr_be_i,',
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

  for (const reg of regs) {
    const named = reg.fields.filter((field) => field.enumValues.length > 0)

    for (const field of named) {
      const pad =
        Math.max(...field.enumValues.map((entry) => entry.constName.length)) +
        reg.constName.length +
        sanitizeConst(field.name).length +
        2

      lines.push('', `  // ${reg.name}.${field.name} named values`)

      for (const entry of field.enumValues) {
        const name = `${reg.constName}_${sanitizeConst(field.name)}_${entry.constName}`
        lines.push(
          `  localparam ${fieldWidthDecl(field)}${name.padEnd(pad)} = ${enumLiteral(field, entry.value)};`
        )
      }
    }
  }

  if (registeredReadback) {
    lines.push('', `  reg [DATA_WIDTH-1:0] ${readTarget};`)
  }

  lines.push(
    '',
    '  // Byte enables expanded to a per-bit write mask',
    '  wire [DATA_WIDTH-1:0] csr_wr_mask = {',
    ...byteMaskLines(dataWidth, 'csr_be_i', '      '),
    '  };'
  )

  // Registers that only feed an auto-increment keep their strobe internal;
  // the rest drive an output port declared in the header above.
  const internalStrobes = strobeRegs.filter((reg) => !reg.writeStrobe)

  if (internalStrobes.length > 0) {
    lines.push('', '  // Write strobes used only to advance a paired register')
    for (const reg of internalStrobes) {
      lines.push(`  reg ${reg.prefix}_wr_q;`)
    }
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
      } else if (field.access === 'W1S') {
        renderSetBlock(lines, reg, field)
      } else if (field.access === 'W1SC') {
        renderSelfClearingBlock(lines, reg, field)
      }
    }
  }

  if (storedFields.length > 0 || storedArrayRegs.length > 0 || strobeRegs.length > 0) {
    lines.push('', '  // CSR write handling', '  always @(posedge clk_i or negedge rstn_i) begin')
    lines.push('    if (!rstn_i) begin')

    for (const { field } of storedFields) {
      lines.push(`      ${field.sig}_o <= ${fieldReset(field)};`)
    }

    for (const reg of scalarStrobeRegs) {
      lines.push(`      ${strobeSignal(reg)} <= 1'b0;`)
    }

    for (const reg of arrayStrobeRegs) {
      lines.push(
        `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
        `        ${strobeSignal(reg)}[${ARRAY_INDEX}] <= 1'b0;`,
        '      end'
      )
    }

    for (const reg of storedArrayRegs) {
      const stored = reg.fields.filter((entry) => isStored(entry.access))

      if (stored.length === 0) {
        continue
      }

      // Reset every instance, including any below firstIndex, so unused
      // entries are still driven.
      lines.push(`      ${arrayLoopHeader(reg, { fromZero: true })} begin`)
      for (const field of stored) {
        lines.push(
          `        ${field.sig}_o[${ARRAY_INDEX}] <= ${fieldReset(field)};`
        )
      }
      lines.push('      end')
    }

    lines.push('    end else begin')

    const pulseArrayRegs = arrayRegs.filter((reg) =>
      reg.fields.some((field) => field.access === 'W1P')
    )

    if (strobeRegs.length > 0) {
      lines.push('      // Write strobes are single cycle: default them low every clock.')

      for (const reg of scalarStrobeRegs) {
        lines.push(`      ${strobeSignal(reg)} <= 1'b0;`)
      }

      for (const reg of arrayStrobeRegs) {
        lines.push(
          `      ${arrayLoopHeader(reg, { fromZero: true })} begin`,
          `        ${strobeSignal(reg)}[${ARRAY_INDEX}] <= 1'b0;`,
          '      end'
        )
      }

      lines.push('')
    }

    if (incRegs.length > 0) {
      lines.push(
        '      // Auto-increment one cycle after the paired write, so the address',
        '      // output still reads as the written entry while the strobe is high.'
      )

      for (const reg of incRegs) {
        for (const target of reg.autoIncrementTargets) {
          lines.push(
            `      if (${strobeSignal(reg)}) begin`,
            `        ${target.sig}_o <= ${target.sig}_o + ${resetLiteral(target.width, 1)};`,
            '      end'
          )
        }
      }

      lines.push('')
    }

    if (pulseFields.length > 0 || pulseArrayRegs.length > 0) {
      lines.push('      // Write-1 pulses are single cycle: default them low every clock.')

      for (const { field } of pulseFields) {
        lines.push(`      ${field.sig}_o <= ${fieldZero(field)};`)
      }

      for (const reg of pulseArrayRegs) {
        lines.push(`      ${arrayLoopHeader(reg, { fromZero: true })} begin`)
        for (const field of reg.fields.filter((entry) => entry.access === 'W1P')) {
          lines.push(
            `        ${field.sig}_o[${ARRAY_INDEX}] <= ${fieldZero(field)};`
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
        lines.push(`            ${storedUpdate(field, ARRAY_INDEX)}`)
      }

      if (needsStrobe(reg)) {
        lines.push(`            ${strobeSignal(reg)}[${ARRAY_INDEX}] <= 1'b1;`)
      }

      lines.push('          end', '        end', '')
    }

    lines.push('        case (csr_addr_i)')

    for (const reg of scalarRegs) {
      const written = reg.fields.filter((field) => isStored(field.access))
      if (written.length === 0 && !needsStrobe(reg)) {
        continue
      }

      lines.push(`          ${reg.constName}_ADDR: begin`)
      for (const field of written) {
        lines.push(`            ${storedUpdate(field)}`)
      }

      if (needsStrobe(reg)) {
        lines.push(`            ${strobeSignal(reg)} <= 1'b1;`)
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
    registeredReadback
      ? '  // Readback path, registered: csr_rdata_o is valid the cycle after csr_rd_en_i'
      : '  // Readback path',
    '  always @(*) begin',
    `    ${readTarget} = {DATA_WIDTH{1'b0}};`,
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
      lines.push(
        `          ${readTarget}${fieldSel(field)} = ${readbackExpr(field)};`
      )
    }
    lines.push('        end')
  }

  lines.push(
    '        default: begin',
    `          ${readTarget} = {DATA_WIDTH{1'b0}};`,
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
      `          ${readTarget} = {DATA_WIDTH{1'b0}};`
    )
    for (const field of readable) {
      lines.push(
        `          ${readTarget}${fieldSel(field)} = ${readbackExpr(field, ARRAY_INDEX)};`
      )
    }
    lines.push('        end', '      end')
  }

  lines.push('    end', '  end', '')

  if (registeredReadback) {
    lines.push(
      '  always @(posedge clk_i or negedge rstn_i) begin',
      '    if (!rstn_i) begin',
      `      csr_rdata_o <= {DATA_WIDTH{1'b0}};`,
      '    end else begin',
      `      csr_rdata_o <= ${readTarget};`,
      '    end',
      '  end',
      ''
    )
  }

  lines.push('endmodule', '')

  return lines.join('\n')
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
    '    // Byte enables are passed through to the register block, which masks',
    '    // each field itself. No read-modify-write, so a partial write never',
    '    // reads back and rewrites the lanes it does not touch, and the read',
    '    // port stays idle during a write.',
    '    assign native_addr_o  = avmm_address_i;',
    '    assign native_wr_en_o = avmm_write_i && |avmm_byteenable_i;',
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

const renderCsrTop = ({
  addrWidth,
  dataWidth,
  parameters,
  ports,
  moduleName,
  blockModuleName,
  bridge,
}) => {
  const { outputs, inputs } = ports
  const allPorts = [...outputs, ...inputs]
  const widthColumn = widthColumnSize(allPorts)

  const slavePorts = [...bridge.slavePorts]

  if (allPorts.length === 0) {
    // Nothing follows, so drop the comma the slave port block ends on.
    slavePorts[slavePorts.length - 1] = slavePorts[slavePorts.length - 1].replace(
      /,$/,
      ''
    )
  }

  const lines = [
    `// Top-level module that connects a single ${bridge.label} bridge to the native CSR block.`,
    `module ${moduleName} #(`,
    `    parameter ADDR_WIDTH = ${addrWidth},`,
    `    parameter DATA_WIDTH = ${dataWidth}${parameters.length > 0 ? ',' : ''}`,
    ...renderParameterDecls(parameters),
    ') (',
    '    input  wire                  clk_i,',
    '    input  wire                  rstn_i,',
    ...slavePorts,
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
    ['csr_be_i', 'native_be'],
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

export const supportedInterfaces = [
  NATIVE_INTERFACE,
  AVALON_MM_INTERFACE,
  AXI4_LITE_INTERFACE,
]
