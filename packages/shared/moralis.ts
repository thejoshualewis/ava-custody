import { MoralisBalance } from './types';
type FetchArgs = { apiKey: string; address: string; chain: 'eth' | 'avalanche'; };
export async function fetchMoralisBalances({ apiKey, address, chain }: FetchArgs): Promise<MoralisBalance[]> {
  const url = `https://deep-index.moralis.io/api/v2.2/${address}/erc20?chain=${chain}`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey } });
  if (!res.ok) { const t = await res.text(); throw new Error(`Moralis error ${res.status}: ${t}`); }
  const json = await res.json();
  return (json ?? []).map((i: any) => ({
    token_address: String(i.token_address || '').toLowerCase(),
    balance: String(i.balance ?? '0'),
  }));
}
