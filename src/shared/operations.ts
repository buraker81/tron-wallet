/**
 * Active permission `operations` bitmask helpers.
 *
 * The mask is 32 bytes (64 hex chars). Contract type id N is enabled when
 * bit (N % 8) of byte floor(N / 8) is set (least-significant bit first).
 * Ids come from java-tron's Transaction.Contract.ContractType enum.
 */

export interface OperationDef {
  id: number
  name: string
  group: string
}

export const OPERATIONS: OperationDef[] = [
  { id: 0, name: 'AccountCreate', group: 'Account' },
  { id: 10, name: 'AccountUpdate', group: 'Account' },
  { id: 19, name: 'SetAccountId', group: 'Account' },
  { id: 46, name: 'AccountPermissionUpdate', group: 'Account' },

  { id: 1, name: 'Transfer (TRX)', group: 'Transfer' },
  { id: 2, name: 'TransferAsset (TRC10)', group: 'Transfer' },

  { id: 54, name: 'FreezeBalanceV2 (stake)', group: 'Stake 2.0' },
  { id: 55, name: 'UnfreezeBalanceV2 (unstake)', group: 'Stake 2.0' },
  { id: 56, name: 'WithdrawExpireUnfreeze', group: 'Stake 2.0' },
  { id: 57, name: 'DelegateResource', group: 'Stake 2.0' },
  { id: 58, name: 'UnDelegateResource', group: 'Stake 2.0' },
  { id: 59, name: 'CancelAllUnfreezeV2', group: 'Stake 2.0' },

  { id: 11, name: 'FreezeBalance (v1)', group: 'Stake 1.0 (legacy)' },
  { id: 12, name: 'UnfreezeBalance (v1)', group: 'Stake 1.0 (legacy)' },

  { id: 4, name: 'VoteWitness', group: 'Voting / SR' },
  { id: 13, name: 'WithdrawBalance (claim rewards)', group: 'Voting / SR' },
  { id: 5, name: 'WitnessCreate', group: 'Voting / SR' },
  { id: 8, name: 'WitnessUpdate', group: 'Voting / SR' },
  { id: 49, name: 'UpdateBrokerage', group: 'Voting / SR' },

  { id: 30, name: 'CreateSmartContract', group: 'Smart contract' },
  { id: 31, name: 'TriggerSmartContract (TRC20 etc.)', group: 'Smart contract' },
  { id: 33, name: 'UpdateSetting', group: 'Smart contract' },
  { id: 45, name: 'UpdateEnergyLimit', group: 'Smart contract' },
  { id: 48, name: 'ClearABI', group: 'Smart contract' },

  { id: 6, name: 'AssetIssue', group: 'TRC10 asset' },
  { id: 9, name: 'ParticipateAssetIssue', group: 'TRC10 asset' },
  { id: 14, name: 'UnfreezeAsset', group: 'TRC10 asset' },
  { id: 15, name: 'UpdateAsset', group: 'TRC10 asset' },

  { id: 16, name: 'ProposalCreate', group: 'Governance' },
  { id: 17, name: 'ProposalApprove', group: 'Governance' },
  { id: 18, name: 'ProposalDelete', group: 'Governance' },

  { id: 41, name: 'ExchangeCreate', group: 'Bancor exchange' },
  { id: 42, name: 'ExchangeInject', group: 'Bancor exchange' },
  { id: 43, name: 'ExchangeWithdraw', group: 'Bancor exchange' },
  { id: 44, name: 'ExchangeTransaction', group: 'Bancor exchange' },

  { id: 52, name: 'MarketSellAsset', group: 'Market' },
  { id: 53, name: 'MarketCancelOrder', group: 'Market' }
]

export const OPERATION_GROUPS = [...new Set(OPERATIONS.map((o) => o.group))]

export function encodeOperations(ids: Iterable<number>): string {
  const bytes = new Uint8Array(32)
  for (const id of ids) {
    if (id < 0 || id > 255) continue
    bytes[id >> 3] |= 1 << (id & 7)
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Returns enabled ids, or null if the hex is not a valid 32-byte mask. */
export function decodeOperations(hex: string): number[] | null {
  const h = hex.trim().replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(h)) return null
  const ids: number[] = []
  for (let i = 0; i < 32; i++) {
    const byte = parseInt(h.slice(i * 2, i * 2 + 2), 16)
    for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) ids.push(i * 8 + bit)
  }
  return ids
}

const ALL_IDS = OPERATIONS.map((o) => o.id)

export const PRESETS: { name: string; ids: number[] }[] = [
  { name: 'Default (all except permission update)', ids: ALL_IDS.filter((id) => id !== 46) },
  { name: 'All', ids: ALL_IDS },
  { name: 'Transfers only (TRX + TRC10 + TRC20)', ids: [1, 2, 31] },
  { name: 'Stake & vote', ids: [4, 13, 54, 55, 56, 57, 58, 59] },
  { name: 'None', ids: [] }
]

export const DEFAULT_OPS = encodeOperations(PRESETS[0].ids)
