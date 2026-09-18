/**
 * Field access types understood by the editor and the RTL generator.
 *
 * `port` describes what the generated CSR block exposes for a field:
 *   out     - a driven output register
 *   in      - a sampled hardware input
 *   out+set - a driven output register plus a hardware set strobe input
 *   out+clr - a driven output register plus a hardware clear request input
 */
export const accessTypes = [
  {
    value: 'RW',
    port: 'out',
    readable: true,
    description: 'Host read/write; value is driven out of the CSR block.',
  },
  {
    value: 'RO',
    port: 'in',
    readable: true,
    description: 'Read-only; value is sampled from a hardware input.',
  },
  {
    value: 'WO',
    port: 'out',
    readable: false,
    description: 'Write-only; value is stored and driven out, reads back 0.',
  },
  {
    value: 'W1C',
    port: 'out+set',
    readable: true,
    description: 'Sticky status set by hardware; host writes 1 to clear.',
  },
  {
    value: 'W1S',
    port: 'out+clr',
    readable: true,
    description: 'Sticky control set by the host writing 1; hardware clears.',
  },
  {
    value: 'W0C',
    port: 'out+set',
    readable: true,
    description: 'Sticky status set by hardware; host writes 0 to clear.',
  },
  {
    value: 'W1P',
    port: 'out',
    readable: false,
    description: 'Write-1 pulse; one-cycle strobe out, reads back 0.',
  },
  {
    value: 'W1SC',
    port: 'out',
    readable: true,
    description:
      'Write-1 self-clearing; asserted for a hold window then auto-clears.',
  },
]

export const accessTypeValues = accessTypes.map((type) => type.value)

export const accessTypeMap = Object.fromEntries(
  accessTypes.map((type) => [type.value, type])
)

export const isAccessType = (value) =>
  Object.prototype.hasOwnProperty.call(accessTypeMap, value)

/** Tailwind fills used by the register diagram, keyed by access type. */
export const accessColorMap = {
  RW: 'fill-blue-200 dark:fill-blue-400',
  RO: 'fill-yellow-200 dark:fill-yellow-400',
  WO: 'fill-green-200 dark:fill-green-400',
  W1C: 'fill-pink-200 dark:fill-pink-400',
  W1S: 'fill-teal-200 dark:fill-teal-400',
  W0C: 'fill-rose-200 dark:fill-rose-400',
  W1P: 'fill-purple-200 dark:fill-purple-400',
  W1SC: 'fill-orange-200 dark:fill-orange-400',
  RSVD: 'fill-neutral-200 dark:fill-neutral-400',
}

/**
 * Clocks a W1SC field stays asserted before it clears itself. Per field, since
 * the window is chosen to suit whatever consumes the strobe: 1 makes it an
 * ordinary single-cycle pulse, and a soft reset usually wants more.
 */
export const DEFAULT_HOLD_CYCLES = 15

/** The hold window a W1SC field is configured for, or the default. */
export const holdCyclesOf = (field) => {
  const value = Number(field?.holdCycles)
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_HOLD_CYCLES
}

/** Width of the counter that times a hold window, sized to the count. */
export const holdCounterWidth = (cycles) => cycles.toString(2).length
