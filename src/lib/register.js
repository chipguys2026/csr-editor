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

export const formatBitRange = (msb, lsb) =>
  msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`
