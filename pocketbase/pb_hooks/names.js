// Display name rules: 2 to 32 characters of letters, digits, spaces, apostrophes, periods, hyphens.
// Returns { display, key } or null. key is the lowercased, whitespace-collapsed identity.
module.exports = function normalizeName(input) {
  if (typeof input !== 'string') return null
  const display = input.trim().replace(/\s+/g, ' ')
  if (display.length < 2 || display.length > 32) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(display)) return null
  return { display, key: display.toLowerCase() }
}
