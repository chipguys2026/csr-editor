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

export const getFieldWidth = (field) =>
  field.bitRange.msb - field.bitRange.lsb + 1

export const calcTotalBitsUsed = (fields) =>
  fields.reduce((sum, field) => sum + getFieldWidth(field), 0)

export const formatBitRange = (msb, lsb) =>
  msb === lsb ? `[${msb}]` : `[${msb}:${lsb}]`
