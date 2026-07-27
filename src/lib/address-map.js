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

export const hasConflict = (entries = []) =>
  new Set(entries.map((entry) => entry.regAddr)).size > 1
