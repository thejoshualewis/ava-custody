import * as React from 'react'
import TokenIcon from './TokenIcon'

export type AssetItem = {
  networkId: number
  contract: string
  symbol: string
  name: string
  decimals: number
  amount: number
  usd: number | null
  logo?: string | null
}

type Props = {
  item: AssetItem
  active?: boolean
}

// Inline, local-only formatters so this doesn't look "generated"
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 })

function formatAmount(n?: number) {
  if (n == null || !isFinite(n)) return '0'
  if (n === 0) return '0'
  if (Math.abs(n) < 0.000001) return '<0.000001'
  if (Math.abs(n) >= 1_000_000_000) return compact.format(n)
  // for 0–1 show more precision, else keep it tidy
  if (Math.abs(n) < 1) return new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 }).format(n)
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)
}

function formatUSD(n?: number | null) {
  if (n == null || !isFinite(n)) return '–'
  if (Math.abs(n) < 0.01 && Math.abs(n) > 0) return '<$0.01'
  if (Math.abs(n) >= 100_000) return `$${compact.format(n)}`
  return `$${nf.format(n)}`
}

function networkLabel(id: number) {
  return id === 1 ? 'Ethereum' : id === 43114 ? 'Avalanche' : `Chain ${id}`
}

export default function AssetRow({ item, active }: Props) {
  const sym = item.symbol || 'UNK'
  const name = item.name || 'Unknown'
  const usd = item.usd ?? null

  return (
   <div
  className="flex items-center justify-between gap-3 px-4 py-3 bg-white"
>
      {/* Left: icon + labels */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full overflow-hidden bg-slate-100 grid place-items-center shrink-0">
          {item.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.logo}
              alt={sym}
              className="h-9 w-9 object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none'
              }}
            />
          ) : (
            <TokenIcon alt={''} />
          )}
        </div>

        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-slate-900 truncate max-w-[180px] sm:max-w-[220px]">
            {sym}
          </div>
          <div className="text-xs text-slate-500 truncate max-w-[220px]">
            {networkLabel(item.networkId)}
            {name !== 'Unknown' ? <span> · {name}</span> : null}
          </div>
        </div>
      </div>

      {/* Right: amount + usd (single line, never overflows) */}
      <div className="min-w-0 text-right">
        <div className="font-semibold text-slate-900 max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap">
          {formatAmount(item.amount)} <span className="text-slate-700">{sym}</span>
        </div>
        <div className="text-xs text-slate-500">{formatUSD(usd)}</div>
      </div>
    </div>
  )
}