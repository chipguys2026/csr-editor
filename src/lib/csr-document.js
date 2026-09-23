import { accessTypes, holdCyclesOf } from './access-types.js'
import {
  formatArrayAddress,
  formatArrayRange,
  formatBitRange,
  normalizeRegister,
  resolveFields,
} from './register.js'

/**
 * The register datasheet: what a reader of the block needs without the tool,
 * laid out in the order a datasheet is read - the block, the map, then each
 * register with its fields MSB first.
 */

const hexOf = (value, digits = 0) =>
  `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`

/**
 * The register's reset value, composed from its fields' - what the flops hold,
 * which a write-only field does not read back. BigInt so a 64-bit register
 * does not lose its top bits to a double.
 */
const registerReset = (fields, dataWidth) => {
  const value = fields.reduce((total, field) => {
    const { msb, lsb } = field.bitRange
    const mask = (1n << BigInt(msb - lsb + 1)) - 1n

    return total | ((BigInt(field.resetValue ?? 0) & mask) << BigInt(lsb))
  }, 0n)

  return hexOf(value, Math.ceil(dataWidth / 4))
}

const enumLabel = (entry, bitmask) => {
  const value = Number(entry?.value ?? 0)
  return bitmask ? `bit ${value}` : hexOf(value)
}

/** One row of a register's field table. */
const fieldRow = (field) => {
  const reserved = field.name === 'RESERVED'
  const bitmask = field.valueKind === 'bitmask'
  const { msb, lsb, width } = field.bitRange

  return {
    reserved,
    name: field.name,
    // A parameter-wide field documents the expression, as the sheet does.
    bits: formatBitRange(msb, lsb, width),
    access: field.type,
    reset: hexOf(Number(field.resetValue ?? 0)),
    description: String(field.desc ?? ''),
    // What only the access type implies, spelled out where it changes behaviour.
    notes: [
      field.type === 'W1SC'
        ? `Holds for ${holdCyclesOf(field)} clock(s), then clears.`
        : null,
      field.type === 'RO' && field.constant
        ? 'Constant: reads back its reset value.'
        : null,
    ].filter(Boolean),
    enumValues: reserved
      ? []
      : (field.enumValues ?? []).map((entry) => ({
          label: enumLabel(entry, bitmask),
          name: String(entry?.name ?? ''),
          description: String(entry?.desc ?? '').trim(),
        })),
  }
}

/**
 * The datasheet model for a document.
 * @param {object} params - Document parameters
 * @param {object} registers - Register map, keyed by address
 */
export const buildDocument = (params = {}, registers = {}) => {
  const dataWidth = Number(params.dataWidth ?? 32)
  const addrWidth = Number(params.addrWidth ?? 16)
  const parameters = params.parameters ?? []
  const digits = Math.ceil(addrWidth / 4)

  const regs = Object.keys(registers)
    .map(Number)
    .sort((a, b) => a - b)
    .map((addr) => {
      const reg = registers[addr]
      const fields = resolveFields(reg?.fields ?? [], parameters)

      return {
        id: `reg-${addr.toString(16)}`,
        name: reg?.name ?? '',
        address: reg?.array
          ? formatArrayAddress(addr, reg.array, addrWidth)
          : hexOf(addr, digits),
        range: reg?.array ? formatArrayRange(reg.array) : null,
        description: String(reg?.description ?? ''),
        resetValue: registerReset(fields, dataWidth),
        // The diagram draws what is declared, reserved gaps filled in by itself.
        diagramFields: fields,
        // The table lists every bit, MSB first, the way the diagram reads.
        rows: normalizeRegister(fields, dataWidth).reverse().map(fieldRow),
      }
    })

  return {
    title: params.moduleName ?? 'CSR',
    summary: [
      ['Module', params.moduleName ?? 'CSR'],
      ['Bus interface', params.interface ?? 'Native'],
      ['Data width', `${dataWidth} bits`],
      ['Address width', `${addrWidth} bits`],
      [
        'Read latency',
        params.registeredReadback ? 'Registered (1 cycle)' : 'Combinational',
      ],
      ['Registers', String(regs.length)],
    ],
    parameters: parameters.map((entry) => ({
      name: entry.name,
      value: String(entry.value),
    })),
    // Every type, used or not: the key reads the same from one block to the
    // next, and says what a type is before anyone reaches for it.
    accessTypes: accessTypes.map((entry) => ({
      type: entry.value,
      description: entry.description,
    })),
    registers: regs,
  }
}
