// packages/shared/coingecko.ts
import { drizzle } from 'drizzle-orm/d1'
import * as schema from '../db/schema'
import { and, eq } from 'drizzle-orm'
import { cgGetJson, chunk, sleep, type Platform } from './cgClient'

type UpsertArgs = {
  db: ReturnType<typeof drizzle>
  env: { CACHE: KVNamespace }
  contracts: string[]                  // lowercase contract addresses
  platform: Platform                   // 'ethereum' | 'avalanche'
  currency?: 'usd'
}

/**
 * Per-contract metadata upsert to avoid SQLite variable limits.
 * Then batch-price by CoinGecko id (small chunks).
 *  - 404 from CG is skipped silently (token remains UNK)
 *  - Responses are KV-cached
 *  - Light throttling between small groups to avoid 429
 *  - No db.query.* usage
 */
export async function upsertTokenMetadataAndPrices({
  db,
  env,
  contracts,
  platform,
  currency = 'usd',
}: UpsertArgs) {
  const networkId = platform === 'ethereum' ? 1 : 43114
  const unique = Array.from(new Set(contracts.map((c) => c.toLowerCase())))

  const META_GROUP = 10
  const META_SLEEP_MS = 1500
  const PRICE_IDS_CHUNK = 50
  const PRICE_SLEEP_MS = 500

  const idsToPrice: string[] = []

  // ---- METADATA (per-contract; no large IN) ----
  for (const group of chunk(unique, META_GROUP)) {
    await Promise.all(
      group.map(async (contract) => {
        // Check if we already know this token for this network (per-contract)
        const existingRows = await db
          .select()
          .from(schema.tokens)
          .where(and(eq(schema.tokens.contract, contract), eq(schema.tokens.networkId, networkId)))
          .limit(1)

        const existing = existingRows[0]
        if (existing?.coingecko_id) {
          idsToPrice.push(existing.coingecko_id)
          return
        }

        // Fetch metadata from CG (404 tolerated)
        const url = `https://api.coingecko.com/api/v3/coins/${platform}/contract/${contract}`
        const cacheKey = `cg:coins:${platform}:${contract}`
        const meta = await cgGetJson(env, url, cacheKey, 24 * 3600)
        if (!meta) {
          // insert minimal row if not present (symbol/name unknown)
          if (!existing) {
            await db
              .insert(schema.tokens)
              .values({
                contract,
                networkId,
                symbol: 'UNK',
                name: 'Unknown',
                decimals: 18,
                logo: null,
                coingecko_id: null,
              })
              .onConflictDoNothing()
          }
          return
        }

        const coingecko_id = meta?.id ?? null
        const name = meta?.name ?? 'Unknown'
        const symbol = meta?.symbol?.toUpperCase?.() ?? 'TKN'
        const decimals =
          meta?.detail_platforms?.[platform]?.decimal_place != null
            ? Number(meta.detail_platforms[platform].decimal_place)
            : 18
        const logo = meta?.image?.small ?? null

        await db
          .insert(schema.tokens)
          .values({
            contract,
            networkId,
            symbol,
            name,
            decimals,
            logo,
            coingecko_id,
          })
          .onConflictDoUpdate({
            target: [schema.tokens.contract, schema.tokens.networkId],
            set: { symbol, name, decimals, logo, coingecko_id },
          })

        if (coingecko_id) idsToPrice.push(coingecko_id)
      }),
    )
    await sleep(META_SLEEP_MS)
  }

  // ---- PRICES (batch by CG id) ----
  const ids = Array.from(new Set(idsToPrice.filter(Boolean)))
  if (!ids.length) return

  for (const group of chunk(ids, PRICE_IDS_CHUNK)) {
    const idsParam = encodeURIComponent(group.join(','))
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=${currency}`
    const cacheKey = `cg:prices:${currency}:${group.join(',')}`

    const priceJson = await cgGetJson(env, url, cacheKey, 120) // 2 min TTL
    if (priceJson) {
      for (const id of group) {
        const v = priceJson?.[id]?.[currency]
        if (typeof v === 'number' && isFinite(v)) {
          await db
            .insert(schema.prices)
            .values({ coingecko_id: id, currency, value: v })
            .onConflictDoUpdate({
              target: [schema.prices.coingecko_id, schema.prices.currency],
              set: { value: v },
            })
        }
      }
    }
    await sleep(PRICE_SLEEP_MS)
  }
}