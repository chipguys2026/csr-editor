import { resolveBitRange } from './register'

/**
 * A C header of register offsets, field shifts and field masks, generated from
 * the same description the register file is built from so the two cannot
 * drift. Hand-maintaining offsets against a map of this size is how a decimal
 * address ends up written as hex.
 */

/** Uppercase C identifier, since every name here ends up inside a macro. */
const sanitizeMacro = (value) => {
  let out = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!out) {
    throw new Error(`Invalid empty identifier from '${value}'`)
  }

  // A macro cannot start with a digit.
  return /^\d/.test(out) ? `N_${out}` : out
}

/**
 * The module name with any trailing _CSR dropped: ISP_CSR_COMMON_CTRL reads
 * worse than ISP_COMMON_CTRL, and ftel_isp_csr_regs.h worse than
 * ftel_isp_regs.h. Names the file and its include guard.
 */
const headerBase = (moduleName) =>
  sanitizeMacro(moduleName ?? 'CSR').replace(/_CSR$/, '')

/**
 * Macro prefix for every definition in the header. Defaults to the same base,
 * but is overridable on its own: software already written against a header has
 * the prefix compiled into every call site, so it has to be able to stay put
 * even when the module is renamed.
 */
export const defaultHeaderPrefix = (moduleName) => headerBase(moduleName)

const hex = (value, digits) =>
  `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`

/** Column the generated comments wrap at, prefix included. */
const COMMENT_WIDTH = 78

/**
 * Break a paragraph into lines that fit. The map stores prose as one line per
 * paragraph and leaves the wrapping to whatever renders it, so the header has
 * to do its own rather than inherit a width chosen for something else. A line
 * that is already indented is a list the author laid out by hand, and is left
 * exactly as it is.
 */
const wrapLine = (line, width) => {
  if (/^\s/.test(line) || line.length <= width) {
    return [line]
  }

  const out = []
  let current = ''

  for (const word of line.split(' ')) {
    if (current && current.length + 1 + word.length > width) {
      out.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }

  if (current) {
    out.push(current)
  }

  return out
}

/**
 * Prose from the register map, reflowed into a block comment so the header
 * carries the same text rather than sending the reader back to the JSON.
 */
const registerComment = (addr, description, digits) => {
  const text = String(description ?? '').trim()

  if (!text) {
    return [`/* ${hex(addr, digits)} */`]
  }

  const head = `/* ${hex(addr, digits)}  `
  const cont = ' *          '
  const [first, ...rest] = text.split('\n')
  const [firstHead, ...firstRest] = wrapLine(first, COMMENT_WIDTH - head.length)

  return [
    `${head}${firstHead}`,
    ...firstRest.map((line) => `${cont}${line}`),
    ...rest.flatMap((line) =>
      line ? wrapLine(line, COMMENT_WIDTH - cont.length).map((part) => `${cont}${part}`) : [' *']
    ),
    ' */',
  ]
}

const fieldComment = (desc) =>
  String(desc ?? '')
    .trim()
    .split('\n')
    .filter((line, index, lines) => line !== '' || lines.length > 1)
    .flatMap((line) => (line ? wrapLine(line, COMMENT_WIDTH - 10) : ['']))
    .map((line) => (line ? `    /* ${line} */` : '    /* */'))

/**
 * An arrayed register has no single offset, so it gets a macro taking the
 * instance index instead of a constant. The field shifts and masks are the
 * same for every instance and are emitted once.
 */
/** Suffixes the field macros already use, which an enumerant cannot reuse. */
const RESERVED_ENUM_NAMES = ['SHIFT', 'MASK', 'RESET']

/**
 * The names a field carries, which are one of two things. A coded field holds
 * one of them at a time, so the name is the value. A bit-flag field holds any
 * combination, so the name is a bit and what it is worth is that bit's mask --
 * which is what lets software write `v & FLAG` rather than work the shift out
 * for itself.
 */
const enumLines = (prefix, regName, fieldName, field, width) => {
  const values = field?.enumValues ?? []

  if (values.length === 0) {
    return []
  }

  const bitmask = field?.valueKind === 'bitmask'
  const limit = bitmask ? width - 1 : 2 ** width - 1
  const seen = new Set()
  const codes = new Set()
  const out = []

  for (const entry of values) {
    const name = sanitizeMacro(entry?.name ?? '')
    const value = Number(entry?.value ?? 0)

    if (RESERVED_ENUM_NAMES.includes(name)) {
      throw new Error(
        `${regName}.${field.name}: '${name}' is already a field macro suffix`
      )
    }

    if (seen.has(name)) {
      throw new Error(`${regName}.${field.name}: duplicate value name '${name}'`)
    }
    seen.add(name)

    if (!Number.isInteger(value) || value < 0 || value > limit) {
      throw new Error(
        bitmask
          ? `${regName}.${field.name}: bit ${entry?.value} for '${name}' is outside a ${width}-bit field`
          : `${regName}.${field.name}: value ${entry?.value} for '${name}' does not fit ${width} bit(s)`
      )
    }

    // Two names for one code is a typo far more often than it is deliberate,
    // and the field cannot hold more codes than its width allows either way.
    if (codes.has(value)) {
      throw new Error(
        bitmask
          ? `${regName}.${field.name}: '${name}' repeats bit ${value}`
          : `${regName}.${field.name}: '${name}' repeats the code ${value}`
      )
    }
    codes.add(value)

    const desc = String(entry?.desc ?? '').trim()
    // The flag's mask, so it can be tested and set directly.
    const literal = bitmask ? 1 << value : value
    const note = [bitmask ? `bit ${value}` : null, desc.split('\n')[0] || null]
      .filter(Boolean)
      .join(', ')

    out.push(
      `#define ${prefix}_${regName}_${fieldName}_${name} 0x${literal.toString(16).toUpperCase()}u` +
        (note ? `   /* ${note} */` : '')
    )
  }

  return out
}

/**
 * An array count is either a literal or the name of a declared parameter. The
 * header needs a number for the span even when the map carries the name.
 */
const resolveCount = (count, parameters) => {
  if (/^\d+$/.test(String(count ?? '').trim())) {
    return Number(count)
  }

  const parameter = parameters.find((entry) => entry.name === count)
  return parameter ? Number(parameter.value) : null
}

const arrayOffset = (prefix, name, addr, stride, digits) =>
  `#define ${prefix}_${name}(i) (${hex(addr, digits)}u + (i) * ${hex(stride, 1)}u)`

export const generateCHeader = (params = {}, registerMap = {}) => {
  const dataWidth = Number(params.dataWidth ?? 32)
  const addrWidth = Number(params.addrWidth ?? 16)
  const parameters = params.parameters ?? []
  const step = dataWidth / 8

  const prefix = params.headerPrefix
    ? sanitizeMacro(params.headerPrefix)
    : defaultHeaderPrefix(params.moduleName)

  // From the module rather than the prefix, so the guard and the file name
  // agree however the prefix has been overridden.
  const guard = `${headerBase(params.moduleName)}_REGS_H`
  // Wide enough for any address the map can hold, so the column stays straight.
  const digits = Math.max(1, Math.ceil(addrWidth / 4))

  const regs = Object.entries(registerMap)
    .map(([addrText, register]) => ({ addr: Number(addrText), register }))
    .sort((a, b) => a.addr - b.addr)

  const lines = [
    `/* Generated from the CSR description for ${params.moduleName ?? 'CSR'}.`,
    ' * Do not edit: regenerate instead, or the header and the register file',
    ' * that software is talking to will disagree.',
    ' *',
    ' * Offsets are byte offsets from the base of the CSR window.',
    ' */',
    `#ifndef ${guard}`,
    `#define ${guard}`,
    '',
    // The PUT helper casts through uint32_t, so the header has to bring its
    // own declaration of it rather than rely on the including file.
    '#include <stdint.h>',
    '',
  ]

  if (regs.length > 0) {
    const last = regs[regs.length - 1]
    // One past the end, so a caller can size the mapping from it. An array
    // runs past its own base address, so the span has to clear the whole bank.
    const array = last.register?.array
    const count = array ? resolveCount(array.count, parameters) : null
    const reach =
      array && count != null
        ? last.addr + Number(array.stride ?? step) * Math.max(1, count)
        : last.addr + step

    lines.push(
      `#define ${prefix}_CSR_SPAN ${hex(reach, digits)}u  /* one past the last register */`,
      ''
    )
  }

  // Names of the scalar registers and the arrays, for the X-macro tables.
  const table = []
  const arrayTable = []

  for (const { addr, register } of regs) {
    const name = sanitizeMacro(register?.name ?? `REG_${addr}`)
    const array = register?.array
    // The whole register at reset, for restoring defaults in one write.
    let resetWord = 0n
    let resetCollision = false

    lines.push(...registerComment(addr, register?.description, digits))

    if (array) {
      const stride = Number(array.stride ?? step)
      lines.push(
        `/* ${array.count} instances, ${stride}-byte stride. */`,
        arrayOffset(prefix, name, addr, stride, digits)
      )
    } else {
      lines.push(`#define ${prefix}_${name} ${hex(addr, digits)}u`)
    }

    for (const field of register?.fields ?? []) {
      const fieldName = sanitizeMacro(field?.name ?? '')
      const { msb, lsb } = resolveBitRange(field?.bitRange ?? {}, parameters)
      const width = msb - lsb + 1
      // Built in BigInt so a full 32-bit field does not come out negative,
      // which is what 1 << 32 - 1 would give through the signed 32-bit shift.
      const mask = ((1n << BigInt(width)) - 1n) << BigInt(lsb)
      const reset = Number(field?.resetValue ?? 0)

      lines.push(
        ...fieldComment(field?.desc),
        `#define ${prefix}_${name}_${fieldName}_SHIFT ${lsb}u`,
        `#define ${prefix}_${name}_${fieldName}_MASK ` +
          `0x${mask.toString(16).toUpperCase().padStart(8, '0')}u   ` +
          `/* [${msb}:${lsb}] ${field?.type ?? ''}, reset 0x${reset.toString(16).toUpperCase()} */`,
        // The field's own reset, unshifted, so it pairs with _PUT.
        `#define ${prefix}_${name}_${fieldName}_RESET 0x${reset.toString(16).toUpperCase()}u`,
        ...enumLines(prefix, name, fieldName, field, width)
      )

      resetWord |= (BigInt(reset) << BigInt(lsb)) & mask
      if (fieldName === 'RESET') {
        resetCollision = true
      }
    }

    if (resetCollision) {
      lines.push(
        `/* No ${prefix}_${name}_RESET: the register has a field called RESET. */`
      )
    } else {
      lines.push(
        `#define ${prefix}_${name}_RESET 0x${resetWord.toString(16).toUpperCase().padStart(8, '0')}u   /* the whole register at reset */`
      )
    }

    if (array) {
      const stride = Number(array.stride ?? step)
      const count = resolveCount(array.count, parameters)
      arrayTable.push([name, hex(addr, digits), `0x${stride.toString(16).toUpperCase()}`, count ?? array.count])
    } else {
      table.push([name, hex(addr, digits)])
    }

    lines.push('')
  }

  if (table.length > 0) {
    const pad = Math.max(...table.map(([entry]) => entry.length))

    lines.push(
      '/* Every register in one list, so a dump or a defaults pass does not have',
      ' * to repeat them:',
      ' *',
      ` *     #define X(name, off) printf("%s = %08x\\n", #name, rd(off));`,
      ` *     ${prefix}_REGISTERS(X)`,
      ' *     #undef X',
      ' */',
      `#define ${prefix}_REGISTERS(X) \\`,
      ...table.map(
        ([entry, off], index) =>
          `    X(${`${entry},`.padEnd(pad + 2)}${off}u)${index < table.length - 1 ? ' \\' : ''}`
      ),
      ''
    )
  }

  if (arrayTable.length > 0) {
    const pad = Math.max(...arrayTable.map(([entry]) => entry.length))

    lines.push(
      '/* The arrayed registers, which have a base and a stride rather than one',
      ' * offset: X(name, base, stride, count).',
      ' */',
      `#define ${prefix}_REGISTER_ARRAYS(X) \\`,
      ...arrayTable.map(
        ([entry, base, stride, count], index) =>
          `    X(${`${entry},`.padEnd(pad + 2)}${base}u, ${stride}u, ${count}u)${index < arrayTable.length - 1 ? ' \\' : ''}`
      ),
      ''
    )
  }

  lines.push(
    '/* Pull a field out of a register value, and place one into it. */',
    `#define ${prefix}_GET(reg, field, v) \\`,
    `    (((v) & ${prefix}_##reg##_##field##_MASK) >> ${prefix}_##reg##_##field##_SHIFT)`,
    `#define ${prefix}_PUT(reg, field, v) \\`,
    `    ((((uint32_t)(v)) << ${prefix}_##reg##_##field##_SHIFT) & ${prefix}_##reg##_##field##_MASK)`,
    '',
    `#endif /* ${guard} */`,
    ''
  )

  return lines.join('\n')
}

/** The header as a downloadable file, named after the module. */
export const generateHeaderFile = (params = {}, registerMap = {}) => ({
  name: `${headerBase(params.moduleName).toLowerCase()}_regs.h`,
  content: generateCHeader(params, registerMap),
})
