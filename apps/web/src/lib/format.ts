export function formatAmount(n: number) {
  if (!isFinite(n)) return '0'
  if (n === 0) return '0'
  if (n < 0.0001) return n.toExponential(2)
  if (n < 1) return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  if (n < 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
export function formatUSD(n: number | null) {
  if (n == null || !isFinite(n)) return '-'
  if (n < 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
