// apps/web/src/ui/App.tsx
import * as React from 'react'
import AssetRow, { type AssetItem } from './AssetRow'

// A prebuilt one for testing on page load
const DEFAULT = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'

// Decide API base:
// - Local dev (localhost/127.0.0.1) -> Wrangler dev API
// - StackBlitz / Pages / other hosts -> Cloudflare Workers API
const hostname = typeof window !== 'undefined' ? window.location.hostname : ''
const isLocalHost = /^(localhost|127\.0\.0\.1)$/i.test(hostname)
const isStackBlitz = /stackblitz\.io$/i.test(hostname) || hostname === 'stackblitz.com'
const isPages = /pages\.dev$/i.test(hostname)

const API_BASE = (isLocalHost)
  ? 'http://127.0.0.1:8787'
  : 'https://ingest-worker.ava-custody-demo.workers.dev' // your deployed Worker

export default function App() {
  const [address, setAddress] = React.useState(DEFAULT)
  const [items, setItems] = React.useState<AssetItem[]>([])
  const [filtered, setFiltered] = React.useState<AssetItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    const q = query.trim().toLowerCase()
    if (!q) return setFiltered(items)
    setFiltered(
      items.filter((it) =>
        [it.symbol, it.name, it.contract, it.networkId === 1 ? 'ethereum' : 'avalanche']
          .join(' ')
          .toLowerCase()
          .includes(q),
      ),
    )
  }, [query, items])

  async function fetchPortfolio(e?: React.FormEvent) {
    e?.preventDefault()
    setError(null); setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/portfolio?address=${address}`)
      if (!res.ok) throw new Error(`Worker error ${res.status}`)
      const json = await res.json()
      const list: AssetItem[] = (json.items ?? []) as any[]
      list.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.amount - a.amount)
      setItems(list)
    } catch (err: any) {
      setError(err?.message ?? 'Error')
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  React.useEffect(() => { fetchPortfolio().catch(()=>{}) }, [])

  return (
    <div className="min-h-screen w-full flex items-start justify-center py-10">
      <div className="w-full max-w-2xl bg-slate-100/60 border border-slate-200 rounded-2xl p-6 shadow-soft">
        <h1 className="text-xl font-semibold text-slate-900">Asset</h1>
        <div className="text-slate-500 text-sm mb-3">Select asset</div>

        <form onSubmit={fetchPortfolio} className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-xl border border-slate-200 bg-white px-10 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔎</span>
          </div>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            title="Filter"
            onClick={() => {/* placeholder */}}
          >
            Filter ⚙️
          </button>
        </form>

        <div className="flex items-center gap-2 mb-4">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x..."
            className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm hover:bg-black disabled:opacity-60"
            onClick={fetchPortfolio}
            disabled={loading}
          >
            {loading ? 'Loading…' : 'Fetch'}
          </button>
        </div>

        {error && <div className="mb-3 text-sm text-rose-600">{error}</div>}

        <div className="rounded-2xl bg-white p-2 shadow-soft border border-slate-100">
          {loading && <div className="p-4 text-slate-400 text-sm">Loading assets…</div>}
          {!loading && filtered.length === 0 && <div className="p-4 text-slate-400 text-sm">No assets</div>}
          <div className="flex flex-col divide-y divide-slate-100">
            {filtered.map((it, idx) => (
              <AssetRow key={it.contract + ':' + it.networkId + ':' + idx} item={it} active={idx === 0} />
            ))}
          </div>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Data: balances via Moralis; metadata/prices via CoinGecko (cached). API: {API_BASE}
        </div>
      </div>
    </div>
  )
}