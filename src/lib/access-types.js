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
    value: 'W2C',
    port: 'out+set',
    readable: true,
    description:
      'Sticky status set by hardware; any host write clears it, whatever ' +
      'the data. Only the byte lanes the write enables are cleared.',
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
      'Write-1 self-clearing; asserted for a hold window then auto-clears. ' +
      'Reads back its live value, so software can poll whether the window is ' +
      'still open.',
  },
]

/**
 * Why a field of this access type cannot be called quasi-static, or null when
 * it can. Only the types software writes and then leaves alone qualify.
 *
 * The pulses are the ones that matter: a false path tells the tool nothing
 * about arrival, so a one-cycle strobe can reach its consumer late or not at
 * all, and no timing report will say so. A status bit hardware drives is
 * simply moving, which is the opposite of the claim.
 */
export const quasiStaticBlocker = (access, field = null) => {
  // Its value lives in the logic outside the block, so there is no field flop
  // here to cut; whatever holds it is constrained where it is.
  if (field?.external) {
    return 'stored outside the CSR block - no field flop to cut'
  }

  // A field the hardware writes is moving by definition. This covers the
  // optional strobes on RW/WO, which the type alone does not tell us about.
  if (field?.hwSet || field?.hwClear) {
    return 'written by hardware during operation, so it is not held still'
  }

  switch (access) {
    case 'RW':
    case 'WO':
      return null
    case 'RO':
      return 'driven from outside - no field flop to cut'
    case 'W1C':
    case 'W0C':
    case 'W2C':
      return 'set by hardware during operation, so it is not held still'
    case 'W1S':
      return 'cleared by hardware during operation, so it is not held still'
    case 'W1P':
      return 'a one-cycle strobe - it has to stay timed'
    case 'W1SC':
      return 'a timed pulse - it has to stay timed'
    default:
      return 'not a type that holds a value'
  }
}

/**
 * Which hardware strobes a type's storage can take, and whether they come
 * with the type or are opt-in per field.
 *
 *   'always'   - the semantics require it: a W1C bit is set by hardware, a
 *                W1S bit is cleared by hardware.
 *   'optional' - the document may ask for the extra port on this one field.
 *   'never'    - there is no stored value to strobe.
 *
 * The value itself is always the field flop and always leaves through `<sig>_o`;
 * these are inputs that write it, never another output.
 */
export const hardwareStrobes = {
  RW: { set: 'optional', clear: 'optional' },
  WO: { set: 'optional', clear: 'optional' },
  W1C: { set: 'always', clear: 'optional' },
  W0C: { set: 'always', clear: 'optional' },
  W2C: { set: 'always', clear: 'optional' },
  W1S: { set: 'optional', clear: 'always' },
  RO: { set: 'never', clear: 'never' },
  W1P: { set: 'never', clear: 'never' },
  W1SC: { set: 'never', clear: 'never' },
}

/** The strobe rules for an access type, defaulting to no storage at all. */
export const hardwareStrobeRule = (access) =>
  hardwareStrobes[access] ?? hardwareStrobes.RO

/**
 * The strobe ports a field gets, from its type widened by its own flags.
 * `field` may be the document field or the resolved model field.
 */
export const fieldStrobes = (field) => {
  const rule = hardwareStrobeRule(field?.type ?? field?.access)

  return {
    set: rule.set === 'always' || (rule.set === 'optional' && Boolean(field?.hwSet)),
    clear:
      rule.clear === 'always' ||
      (rule.clear === 'optional' && Boolean(field?.hwClear)),
  }
}

/** Why a strobe cannot be offered on this type, or null when it can. */
export const hardwareStrobeBlocker = (access, which) =>
  hardwareStrobeRule(access)[which] === 'never'
    ? `${access} has no stored value to ${which === 'set' ? 'set' : 'clear'}`
    : null

/**
 * External fields: the bus behaviour of the access type, with the value held
 * outside the generated block. The block still decodes the address and the
 * byte lanes, then hands the write on as a one-cycle request and reads the
 * value back from an input. This is for a word whose storage the block cannot
 * describe: several copies behind one address chosen by other state, a write
 * the logic may refuse, or a count kept inside another unit.
 *
 * Per type, what the block hands on (all registered, one clock after the
 * write, and low otherwise):
 *
 *   RW / WO          <sig>_wr_o pulse, <sig>_wdata_o, <sig>_wmask_o
 *   W1C              <sig>_clr_o = written ones in the enabled lanes
 *   W0C              <sig>_clr_o = written zeros in the enabled lanes
 *   W2C              <sig>_clr_o = every bit of the enabled lanes
 *   W1S              <sig>_set_o = written ones in the enabled lanes
 *
 * Every readable external field reads back <sig>_i.
 */
export const externalWrite = {
  RW: 'data',
  WO: 'data',
  W1C: 'clear',
  W0C: 'clear',
  W2C: 'clear',
  W1S: 'set',
}

/** Why a field of this type cannot be external, or null when it can. */
export const externalBlocker = (access) => {
  if (externalWrite[access]) {
    return null
  }

  switch (access) {
    case 'RO':
      return 'RO already reads its value from outside the block'
    case 'W1P':
      return 'W1P stores nothing - its pulse already leaves the block'
    case 'W1SC':
      return 'W1SC times its own hold window inside the block'
    default:
      return 'not a type that can be held outside the block'
  }
}

export const accessTypeValues = accessTypes.map((type) => type.value)

export const accessTypeMap = Object.fromEntries(
  accessTypes.map((type) => [type.value, type])
)

export const isAccessType = (value) =>
  Object.prototype.hasOwnProperty.call(accessTypeMap, value)

/**
 * Tailwind colours keyed by access type. The editor uses fill utilities;
 * React PDF converts the light background utilities into legend and SVG fills.
 * Keep the class names here so exports do not need a separate hex palette.
 */
export const accessColorMap = {
  RW: 'fill-blue-200 bg-blue-200 dark:fill-blue-400 dark:bg-blue-400',
  RO: 'fill-yellow-200 bg-yellow-200 dark:fill-yellow-400 dark:bg-yellow-400',
  WO: 'fill-green-200 bg-green-200 dark:fill-green-400 dark:bg-green-400',
  W1C: 'fill-pink-200 bg-pink-200 dark:fill-pink-400 dark:bg-pink-400',
  W1S: 'fill-teal-200 bg-teal-200 dark:fill-teal-400 dark:bg-teal-400',
  W0C: 'fill-rose-200 bg-rose-200 dark:fill-rose-400 dark:bg-rose-400',
  W2C: 'fill-fuchsia-200 bg-fuchsia-200 dark:fill-fuchsia-400 dark:bg-fuchsia-400',
  W1P: 'fill-purple-200 bg-purple-200 dark:fill-purple-400 dark:bg-purple-400',
  W1SC: 'fill-orange-200 bg-orange-200 dark:fill-orange-400 dark:bg-orange-400',
  RSVD: 'fill-neutral-200 bg-neutral-200 dark:fill-neutral-400 dark:bg-neutral-400',
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
