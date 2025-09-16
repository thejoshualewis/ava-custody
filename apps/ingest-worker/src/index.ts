// apps/ingest-worker/src/index.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../../../packages/db/schema'
import { fetchMoralisBalances } from '../../../packages/shared/moralis'
import { upsertTokenMetadataAndPrices } from '../../../packages/shared/coingecko'
import { CHAINS } from '../../../packages/shared/chains'
import { normalizeAddress } from '../../../packages/shared/types'
import { and, eq } from 'drizzle-orm'

type Env = {
  DB: D1Database
  CACHE: KVNamespace
  MORALIS_API_KEY: string
  CG_API_KEY?: string
  ADDRESS?: string
  INGEST_MAX_TOKENS?: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS for local dev + Cloudflare Pages (*.pages.dev)
app.use(
  '*',
  cors({
    origin: (origin, c) => {
      // No Origin (eg curl) -> don't set CORS
      if (!origin) return undefined

      // Explicit local allows
      const allow = ['http://localhost:3000', 'http://127.0.0.1:3000']
      if (allow.includes(origin)) return origin

      // Cloudflare Pages preview/prod
      if (/^https:\/\/[a-z0-9-]+\.pages\.dev$/i.test(origin)) return origin

      // StackBlitz editor/preview
      if (origin === 'https://stackblitz.com') return origin
      if (/^https:\/\/([a-z0-9-]+\.)?stackblitz\.io$/i.test(origin)) return origin

      // Everything else: no CORS header
      return undefined
    },
    allowMethods: ['GET', 'OPTIONS'],
    allowHeaders: ['*'],
    maxAge: 86400,
  }),
)

// ensure tables exist; optionally autoseed once if ADDRESS is set
app.use('*', async (c, next) => {
  await ensureSchema(c.env.DB)
  await autoSeedIfNeeded(c)
  await next()
})

app.get('/', (c) =>
  c.json({
    ok: true,
    endpoints: {
      ingest: '/ingest?address=0x...',
      portfolio: '/portfolio?address=0x...',
      stats: '/stats',
    },
  }),
)

// ---------- FAST /ingest (immediate response) ----------
app.get('/ingest', async (c) => {
  try {
    const addressRaw = c.req.query('address') || c.env.ADDRESS
    if (!addressRaw) return c.text('missing address', 400)

    // optional per-request cap: /ingest?address=0x...&limit=100
    const limitParam = c.req.query('limit')
    if (limitParam) (c.env as any).INGEST_MAX_TOKENS = limitParam

    const db = drizzle(c.env.DB, { schema })
    const address = normalizeAddress(addressRaw)

    // Ensure base rows
    await seedNetworks(db)
    await db.insert(schema.addresses).values({ id: address }).onConflictDoNothing()

    // 1) FAST PATH: persist balances & minimal token rows immediately
    const { insertedBalances, touchedContractsByPlatform } = await ingestBalancesMinimal(
      c.env,
      db,
      address,
    )

    // 2) Background: enrich tokens & prices with CoinGecko (non-blocking)
    c.executionCtx.waitUntil(
      (async () => {
        for (const chain of [CHAINS.ethereum, CHAINS.avalanche]) {
          const platform = chain.coingecko_platform as 'ethereum' | 'avalanche'
          const contracts = touchedContractsByPlatform[platform] ?? []
          if (!contracts.length) continue
          await upsertTokenMetadataAndPrices({
            db,
            env: { CACHE: c.env.CACHE },
            contracts,
            platform,
          })
        }
      })(),
    )

    // 3) Return immediately so curl/UI is not stuck
    return c.json({
      status: 'queued',
      message: 'Balances stored. Metadata & prices are refreshing in the background.',
      counts: { balances: insertedBalances },
    })
  } catch (e: any) {
    return c.json({ status: 'error', message: String(e?.message || e) }, 500)
  }
})

app.get('/stats', async (c) => {
  const db = drizzle(c.env.DB, { schema })
  const networks = await db.select().from(schema.networks)
  const addresses = await db.select().from(schema.addresses)
  const balances = await db.select().from(schema.balances)
  const tokens = await db.select().from(schema.tokens)
  const prices = await db.select().from(schema.prices)
  return c.json({
    networks: networks.length,
    addresses: addresses.length,
    balances: balances.length,
    tokens: tokens.length,
    prices: prices.length,
  })
})

app.get('/portfolio', async (c) => {
  const q = c.req.query('address')
  if (!q) return c.text('missing address', 400)
  const address = normalizeAddress(q)
  const db = drizzle(c.env.DB, { schema })

  const balances = await db
    .select()
    .from(schema.balances)
    .where(eq(schema.balances.addressId, address))

  const items: any[] = []
  for (const b of balances) {
    // per-row lookup; no big IN queries
    const tokenRows = await db
      .select()
      .from(schema.tokens)
      .where(and(eq(schema.tokens.contract, b.contract), eq(schema.tokens.networkId, b.networkId)))
      .limit(1)
    const t =
      tokenRows[0] ||
      ({
        symbol: 'UNK',
        name: 'Unknown',
        decimals: 18,
        logo: null,
        coingecko_id: null,
      } as any)

    const priceRows =
      t.coingecko_id &&
      (await db
        .select()
        .from(schema.prices)
        .where(and(eq(schema.prices.coingecko_id, t.coingecko_id), eq(schema.prices.currency, 'usd')))
        .limit(1))

    const decimals = t.decimals ?? 18
    const raw = BigInt(b.rawBalance || '0')
    const denom = 10n ** BigInt(decimals)
    const amount = Number(raw) / Number(denom)
    const usd = priceRows && priceRows[0] ? amount * priceRows[0].value : null

    items.push({
      networkId: b.networkId,
      contract: b.contract,
      symbol: t.symbol,
      name: t.name,
      decimals,
      amount,
      usd,
      logo: t.logo,
    })
  }

  items.sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1) || b.amount - a.amount)
  return c.json({ items })
})

// ---------- helpers ----------

/**
 * Fetch balances from Moralis for both chains, cap to MAX_TOKENS,
 * upsert balances immediately, and ensure a minimal token row exists so the
 * frontend can render amounts without waiting for CoinGecko.
 */
async function ingestBalancesMinimal(
  env: { MORALIS_API_KEY: string; CACHE: KVNamespace; INGEST_MAX_TOKENS?: string },
  db: ReturnType<typeof drizzle>,
  address: string,
): Promise<{
  insertedBalances: number
  touchedContractsByPlatform: Record<'ethereum' | 'avalanche', string[]>
}> {
  const DEFAULT_MAX = 200
  const MAX_TOKENS = Number((env.INGEST_MAX_TOKENS as any) ?? DEFAULT_MAX) || DEFAULT_MAX

  let inserted = 0
  const touched: Record<'ethereum' | 'avalanche', string[]> = { ethereum: [], avalanche: [] }

  for (const chain of [CHAINS.ethereum, CHAINS.avalanche]) {
    const platform = chain.coingecko_platform as 'ethereum' | 'avalanche'
    const balancesAll = await fetchMoralisBalances({
      apiKey: env.MORALIS_API_KEY,
      address,
      chain: chain.moralisChain,
    })

    const balances = balancesAll.slice(0, MAX_TOKENS)
    const contracts = Array.from(
      new Set(balances.map((b: any) => String(b.token_address).toLowerCase())),
    )

    // Ensure minimal token rows (UNK) so UI shows immediately
    for (const contract of contracts) {
      const exists = await db
        .select()
        .from(schema.tokens)
        .where(and(eq(schema.tokens.contract, contract), eq(schema.tokens.networkId, chain.id)))
        .limit(1)
      if (!exists[0]) {
        await db
          .insert(schema.tokens)
          .values({
            contract,
            networkId: chain.id,
            symbol: 'UNK',
            name: 'Unknown',
            decimals: 18,
            logo: null,
            coingecko_id: null,
          })
          .onConflictDoNothing()
      }
    }

    // Upsert balances now
    for (const b of balances) {
      const contract = String(b.token_address).toLowerCase()
      await db
        .insert(schema.balances)
        .values({
          addressId: address,
          contract,
          networkId: chain.id,
          rawBalance: String(b.balance),
        })
        .onConflictDoUpdate({
          target: [
            schema.balances.addressId,
            schema.balances.contract,
            schema.balances.networkId,
          ],
          set: { rawBalance: String(b.balance) },
        })
      inserted++
    }

    touched[platform] = contracts
  }

  return { insertedBalances: inserted, touchedContractsByPlatform: touched }
}

async function seedNetworks(db: ReturnType<typeof drizzle>) {
  await db
    .insert(schema.networks)
    .values([
      { id: 1, slug: 'ethereum', name: 'Ethereum', coingecko_platform: 'ethereum' },
      { id: 43114, slug: 'avalanche', name: 'Avalanche C-Chain', coingecko_platform: 'avalanche' },
    ])
    .onConflictDoNothing()
}

async function ensureSchema(DB: D1Database) {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS networks (id INTEGER PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, coingecko_platform TEXT NOT NULL);`,
    `CREATE TABLE IF NOT EXISTS addresses (id TEXT PRIMARY KEY, label TEXT);`,
    `CREATE TABLE IF NOT EXISTS tokens (contract TEXT NOT NULL, network_id INTEGER NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL, decimals INTEGER NOT NULL, logo TEXT, coingecko_id TEXT, PRIMARY KEY (contract, network_id));`,
    `CREATE TABLE IF NOT EXISTS balances (address_id TEXT NOT NULL, contract TEXT NOT NULL, network_id INTEGER NOT NULL, raw_balance TEXT NOT NULL, updated_at INTEGER DEFAULT (unixepoch()), PRIMARY KEY (address_id, contract, network_id));`,
    `CREATE TABLE IF NOT EXISTS prices (coingecko_id TEXT NOT NULL, currency TEXT NOT NULL, value REAL NOT NULL, updated_at INTEGER DEFAULT (unixepoch()), PRIMARY KEY (coingecko_id, currency));`,
  ]
  for (const sql of stmts) await DB.prepare(sql).run()
}

async function autoSeedIfNeeded(c: any) {
  const addr = c.env.ADDRESS
  if (!addr) return
  const key = `seeded:${addr.toLowerCase()}`
  const already = await c.env.CACHE.get(key)
  if (already) return
  try {
    const db = drizzle(c.env.DB, { schema })
    await ingestBalancesMinimal(c.env, db, normalizeAddress(addr))
    await c.env.CACHE.put(key, '1', { expirationTtl: 86400 })
  } catch (e) {
    console.log('Auto-seed failed:', e)
  }
}

export default app