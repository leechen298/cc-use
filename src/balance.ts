import type { Profile } from './profile.js';

export interface BalanceResult {
  balance: number;
  currency?: string;
}

export async function readBalance(adapter: string, _profile: Profile): Promise<BalanceResult> {
  throw new Error(`balance adapter '${adapter}' is not implemented`);
}
