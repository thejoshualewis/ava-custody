// packages/shared/cgClient.ts
export type Platform = 'ethereum' | 'avalanche'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * CoinGecko fetch with:
 * - KV cache
 * - retry-after backoff on 429
 * - 404 => null (skip)
 */
export async function cgGetJson(
  env: { CACHE: KVNamespace },
  url: string,
  cacheKey: string,
  ttlSec = 3600, // 1h default
): Promise<any | null> {
  const cached = await env.CACHE.get(cacheKey)
  if (cached) return JSON.parse(cached)

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ava-custody/1.0 (+ops@example.com)',
        'Accept': 'application/json',
      },
    })
    if (res.ok) {
      const json = await res.json()
      await env.CACHE.put(cacheKey, JSON.stringify(json), { expirationTtl: ttlSec })
      return json
    }
    if (res.status === 404) return null
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after') || 2)
      await sleep(Math.max(ra, 2) * 1000)
      continue
    }
    await sleep(500 * (attempt + 1))
  }
  return null
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}