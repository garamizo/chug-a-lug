// Accept US national numbers or an explicit +1 country prefix, never letters.
module.exports = function normalizePhone(input) {
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (!/^[+\d\s().-]+$/.test(value)) return null
  if (value.includes('+') && !/^\+1[\s().\d-]*$/.test(value)) return null
  const digits = value.replace(/\D/g, '')
  if (digits.length === 10 && !value.startsWith('+')) return '+1' + digits
  if (digits.length === 11 && digits[0] === '1') return '+' + digits
  return null
}
