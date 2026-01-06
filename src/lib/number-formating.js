export const hex = (num, width) => {
  const hexDigits = Math.ceil(width / 4)
  return `0x${num.toString(16).padStart(hexDigits, '0').toLowerCase()}`
}
