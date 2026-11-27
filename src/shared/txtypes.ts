/**
 * Transaction types shown in history: one entry per contract type (plus a few derived ones), in display order.
 * `contracts` are TRON contract type names without the "Contract" suffix, as they come from TronGrid.
 */
export interface TxTypeDef {
  key: string
  label: string
  contracts: string[]
}

export const TX_TYPES: TxTypeDef[] = [
  { key: 'transfer', label: 'trx transfer', contracts: ['Transfer'] },
  // derived: a TRX transfer that created the receiving account, or an AccountCreate contract
  { key: 'account-create', label: 'account create', contracts: ['AccountCreate'] },
  // derived: TRC20 transfer (from the TRC20 feed, merged onto the contract call)
  { key: 'trc20', label: 'trc20 transfer', contracts: [] },
  { key: 'trc10', label: 'trc10 transfer', contracts: ['TransferAsset'] },
  { key: 'contract-call', label: 'contract call', contracts: ['TriggerSmart'] },
  { key: 'deploy', label: 'deploy contract', contracts: ['CreateSmart'] },
  { key: 'stake', label: 'stake', contracts: ['FreezeBalanceV2'] },
  { key: 'unstake', label: 'unstake', contracts: ['UnfreezeBalanceV2'] },
  { key: 'cancel-unstake', label: 'cancel unstakes', contracts: ['CancelAllUnfreezeV2'] },
  { key: 'withdraw-unstaked', label: 'withdraw unstaked', contracts: ['WithdrawExpireUnfreeze'] },
  { key: 'delegate', label: 'delegate', contracts: ['DelegateResource'] },
  { key: 'undelegate', label: 'undelegate', contracts: ['UnDelegateResource'] },
  { key: 'vote', label: 'vote', contracts: ['VoteWitness'] },
  { key: 'claim', label: 'claim rewards', contracts: ['WithdrawBalance'] },
  { key: 'permission', label: 'permission update', contracts: ['AccountPermissionUpdate'] },
  { key: 'account-update', label: 'account update', contracts: ['AccountUpdate', 'SetAccountId'] },
  { key: 'stake-v1', label: 'stake (v1)', contracts: ['FreezeBalance'] },
  { key: 'unstake-v1', label: 'unstake (v1)', contracts: ['UnfreezeBalance', 'UnfreezeAsset'] },
  { key: 'witness', label: 'witness', contracts: ['WitnessCreate', 'WitnessUpdate', 'UpdateBrokerage'] },
  { key: 'proposal', label: 'proposal', contracts: ['ProposalCreate', 'ProposalApprove', 'ProposalDelete'] },
  { key: 'contract-settings', label: 'contract settings', contracts: ['UpdateSetting', 'UpdateEnergyLimit', 'ClearABI'] },
  { key: 'trc10-issue', label: 'trc10 issue', contracts: ['AssetIssue', 'ParticipateAssetIssue', 'UpdateAsset'] },
  { key: 'exchange', label: 'exchange', contracts: ['ExchangeCreate', 'ExchangeInject', 'ExchangeWithdraw', 'ExchangeTransaction'] },
  { key: 'market', label: 'market', contracts: ['MarketSellAsset', 'MarketCancelOrder'] }
]

const BY_CONTRACT = new Map(TX_TYPES.flatMap((t) => t.contracts.map((c) => [c, t.key] as const)))
const LABEL = new Map(TX_TYPES.map((t) => [t.key, t.label]))
const ORDER = new Map(TX_TYPES.map((t, i) => [t.key, i]))

/** Type key for a contract type; unknown types get their own key (lower-case name). */
export const typeKey = (contract: string): string => BY_CONTRACT.get(contract) ?? contract.toLowerCase()
export const typeLabel = (key: string): string => LABEL.get(key) ?? key
/** Sort order for chips: known types first in table order, then unknown ones alphabetically. */
export const typeOrder = (key: string): number => ORDER.get(key) ?? 1000

/** Where a tx's burned TRX went. */
export interface FeeSplit {
  /** bandwidth burned because staked + free bandwidth did not cover the tx */
  bandwidth: number
  /** energy burned because available energy did not cover the contract call */
  energy: number
  /** creating a new account: 1 TRX system fee + its 0.1 TRX bandwidth fee */
  activation: number
  memo: number
  multisig: number
  permission: number
  /** anything not explained by the above (witness / asset issue fees, changed parameters…) */
  other: number
}

export const FEE_PARTS: { key: keyof FeeSplit; label: string; hint: string }[] = [
  { key: 'bandwidth', label: 'bandwidth shortage', hint: 'not enough staked or free bandwidth, so TRX was burned' },
  { key: 'energy', label: 'energy shortage', hint: 'not enough energy for the contract call, so TRX was burned' },
  { key: 'activation', label: 'account creation', hint: 'sending to a new address: 1 TRX system fee + 0.1 TRX bandwidth' },
  { key: 'memo', label: 'memo', hint: 'note stored on chain' },
  { key: 'multisig', label: 'multi-signature', hint: 'tx with more than one signature' },
  { key: 'permission', label: 'permission update', hint: 'AccountPermissionUpdate fee' },
  { key: 'other', label: 'other', hint: 'fees not explained by the above' }
]

export const ZERO_FEES: FeeSplit = { bandwidth: 0, energy: 0, activation: 0, memo: 0, multisig: 0, permission: 0, other: 0 }
