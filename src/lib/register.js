export const normalizeRegister = (fields, regWidth = 32) => {
  const sorted = [...fields].sort((a, b) => a.bitRange.lsb - b.bitRange.lsb)

  const result = []
  let currentBit = 0
  let trueIndex = 0

  for (const field of sorted) {
    const { lsb, msb } = field.bitRange

    if (lsb > currentBit) {
      result.push({
        name: 'RESERVED',
        type: 'RO',
        bitRange: { msb: lsb - 1, lsb: currentBit },
        resetValue: 0,
        desc: 'Reserved',
        trueIndex: trueIndex,
      })
    }

    result.push({
      ...field,
      trueIndex: trueIndex++,
    })

    currentBit = msb + 1
  }

  if (currentBit < regWidth) {
    result.push({
      name: 'RESERVED',
      type: 'RO',
      bitRange: { msb: regWidth - 1, lsb: currentBit },
      resetValue: 0,
      desc: 'Reserved',
      trueIndex: trueIndex,
    })
  }

  return result
}

/** True when the value can be used directly as an array count. */
export const isLiteralCount = (count) =>
  /^\d+$/.test(String(count ?? '').trim()) && Number(count) > 0

/** Address of one array instance: base + (index - firstIndex) * stride. */
export const arrayInstanceAddress = (addr, array, index) =>
  addr + (index - Number(array?.firstIndex ?? 0)) * Number(array?.stride ?? 0)

/** e.g. "0x0024 + 12·(L-1)" — how an array instance's address is computed. */
export const formatArrayAddress = (addr, array, addrWidth = 16) => {
  const base = `0x${addr.toString(16).toUpperCase().padStart(Math.ceil(addrWidth / 4), '0')}`
  const first = Number(array?.firstIndex ?? 0)
  const index = first === 0 ? 'L' : `(L-${first})`

  return `${base} + ${array?.stride}·${index}`
}

/** e.g. "L = 1..NUM_LANES-1" — the index range an array covers. */
export const formatArrayRange = (array) => {
  const first = Number(array?.firstIndex ?? 0)
  return `L = ${first}..${array?.count}-1`
}

export const getFieldWidth = (field) =>
  field.bitRange.msb - field.bitRange.lsb + 1

export const calcTotalBitsUsed = (fields) =>
  fields.reduce((sum, field) => sum + getFieldWidth(field), 0)

/**
 * A bit range is either fixed (`[15:8]`) or parameter-wide (`[8 +: NUM_LANES]`,
 * SystemVerilog's indexed part-select). The parameterised form stores the width
 * expression plus a resolved msb, so everything that only needs numbers keeps
 * working; `resolveBitRange` re-derives that msb from the current parameters.
 */
export const resolveWidth = (bitRange, parameters = []) => {
  const width = bitRange?.width

  if (width == null || width === '') {
    return bitRange.msb - bitRange.lsb + 1
  }

  if (/^\d+$/.test(String(width))) {
    return Number(width)
  }

  const parameter = parameters.find((entry) => entry.name === width)
  return parameter ? parameter.value : null
}

export const resolveBitRange = (bitRange, parameters = []) => {
  const width = resolveWidth(bitRange, parameters)

  if (width == null) {
    // Unresolved parameter: fall back to the msb stored with the field.
    return { msb: bitRange.msb, lsb: bitRange.lsb }
  }

  return { msb: bitRange.lsb + width - 1, lsb: bitRange.lsb }
}

/** Fields with their parameterised widths resolved to plain numbers. */
export const resolveFields = (fields = [], parameters = []) =>
  fields.map((field) => ({
    ...field,
    bitRange: { ...field.bitRange, ...resolveBitRange(field.bitRange, parameters) },
  }))

export const formatBitRange = (msb, lsb, width) => {
  if (width != null && width !== '') {
    return `[${lsb} +: ${width}]`
  }

  return msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`
}

/**
 * Problems that a field cannot report at the moment it is typed: a parameter
 * can be renamed or widened afterwards, pushing a field past the end of the
 * register or into its neighbour.
 */
export const fieldIssues = (fields = [], dataWidth = 32, parameters = []) => {
  const issues = []
  const placed = []

  for (const field of fields) {
    const spec = field.bitRange?.width
    const width = resolveWidth(field.bitRange, parameters)

    if (width == null) {
      issues.push({
        name: field.name,
        message: `width '${spec}' is not a declared parameter`,
      })
      continue
    }

    const lsb = field.bitRange.lsb
    const msb = lsb + width - 1

    if (msb >= dataWidth) {
      issues.push({
        name: field.name,
        message: `${formatBitRange(msb, lsb, spec)} reaches bit ${msb}, past the ${dataWidth}-bit register`,
      })
      continue
    }

    placed.push({ name: field.name, lsb, msb, spec })
  }

  placed.sort((a, b) => a.lsb - b.lsb)

  for (let index = 1; index < placed.length; index += 1) {
    const previous = placed[index - 1]
    const current = placed[index]

    if (current.lsb <= previous.msb) {
      issues.push({
        name: current.name,
        message: `${formatBitRange(current.msb, current.lsb, current.spec)} overlaps ${previous.name} at bit ${current.lsb}`,
      })
    }
  }

  return issues
}

/** Parse `[15:8]`, `[3]` or `[8 +: NUM_LANES]` back into a bit range. */
export const parseBitRange = (text) => {
  const stripped = String(text).replace(/[[\]]/g, '').trim()

  const parameterised = stripped.match(/^(\d+)\s*\+:\s*([A-Za-z_]\w*|\d+)$/)
  if (parameterised) {
    const lsb = Number(parameterised[1])
    return { lsb, msb: lsb, width: parameterised[2] }
  }

  if (stripped.includes(':')) {
    const [msb, lsb] = stripped.split(':').map((part) => Number(part))
    return { msb, lsb }
  }

  const bit = Number(stripped)
  return { msb: bit, lsb: bit }
}
