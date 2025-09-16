import { getAddress } from 'viem/utils';
export function normalizeAddress(addr: string): string {
  try { return getAddress(addr); } catch { return addr.toLowerCase(); }
}
export type MoralisBalance = { token_address: string; balance: string; };
