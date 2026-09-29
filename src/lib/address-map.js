import { arrayInstanceAddress, isLiteralCount } from './register.js'

/**
 * Resolve an array count to a number. Returns null when it names a parameter
 * that has not been declared, which the register map renders as unresolved
 * rather than guessing.
 */
export const resolveCount = (count, parameters = []) => {
  if (isLiteralCount(count)) {
    return Number(count)
  }

  const parameter = parameters.find((entry) => entry.name === count)
  return parameter ? parameter.value : null
}

/**
 * Which register claims each address, with an array claiming every slot it
 * reaches at its configured count. An address claimed by more than one
 * register is a conflict — the same one the RTL generator refuses to emit.
 */
export const buildAddressMap = (registers = {}, parameters = []) => {
  const claims = new Map()

  const claim = (addr, entry) => {
    const list = claims.get(addr) ?? []
    list.push(entry)
    claims.set(addr, list)
  }

  for (const [addrText, reg] of Object.entries(registers)) {
    const base = Number(addrText)

    if (!reg?.array) {
      claim(base, { regAddr: base, name: reg?.name, index: null })
      continue
    }

    const firstIndex = Number(reg.array.firstIndex ?? 0)
    const count = resolveCount(reg.array.count, parameters)

    if (count == null) {
      // Unresolved count: only the base slot is known.
      claim(base, { regAddr: base, name: reg.name, index: firstIndex })
      continue
    }

    for (let index = firstIndex; index < count; index += 1) {
      claim(arrayInstanceAddress(base, reg.array, index), {
        regAddr: base,
        name: reg.name,
        index,
      })
    }
  }

  return claims
}

/**
 * Rows for the register map: one per claimed address, plus one collapsed row
 * per run of free ones. Listing every word does not scale — a 32-bit space is
 * a billion rows, too much to allocate and taller than a browser will let an
 * element be — so the row count follows the number of registers instead.
 */
export const buildRows = (addressMap, step, maxAddr) => {
  const claimed = [...addressMap.keys()].sort((a, b) => a - b)
  const rows = []
  let cursor = 0

  for (const addr of claimed) {
    if (addr > cursor) {
      rows.push({ id: cursor, type: 'gap', start: cursor, end: addr - step })
    }

    rows.push({ id: addr, type: 'register', addr })
    cursor = addr + step
  }

  if (cursor <= maxAddr) {
    rows.push({ id: cursor, type: 'gap', start: cursor, end: maxAddr })
  }

  return rows
}

export const hasConflict = (entries = []) =>
  new Set(entries.map((entry) => entry.regAddr)).size > 1
