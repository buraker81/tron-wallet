import type { FeeSplit } from './txtypes'
import type { FeeBucket, Filters, Totals } from './historyData'

export type NetworkId = 'shasta' | 'nile' | 'mainnet'
export type Resource = 'ENERGY' | 'BANDWIDTH'

export type KeySource = 'file' | 'hd' | 'random' | 'imported' | 'watch'

export interface PublicKey {
  id: number
  address: string
  label?: string
  source: KeySource
  /** false for watch-only addresses */
  canSign: boolean
  hd?: { mnemonicId: string; index: number; path: string }
}

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
  path: string
  autoLockMinutes: number
}

export interface MnemonicInfo {
  id: string
  name: string
  words: number
  hasPassphrase: boolean
  nextIndex: number
  derived: number
  createdAt: number
}

export interface Balances {
  address: string
  activated: boolean
  trx: number
  usdt: number | null
  energy: { used: number; limit: number }
  bandwidth: { used: number; limit: number }
  frozen: { type: Resource; amount: number }[]
  unfreezing: { amount: number; expireAt: number }[]
  tronPower: number
  votes: { address: string; count: number }[]
  /** TRX delegated to others / received from others, per resource */
  delegatedOut: { energy: number; bandwidth: number }
  delegatedIn: { energy: number; bandwidth: number }
}

export interface Delegation {
  /** the other side: receiver for outgoing, delegator for incoming */
  address: string
  resource: Resource
  amount: number
  /** ms timestamp; 0 when not locked */
  lockedUntil: number
}

export interface DelegationInfo {
  out: Delegation[]
  in: Delegation[]
  maxDelegatable: { energy: number; bandwidth: number }
  /** chain limit in blocks (3 s each) */
  maxLockPeriodBlocks: number
}

export interface TxResult {
  txid: string
  ok: boolean
  message?: string
  /** set when the tx was signed but does not have enough weight yet (multisig) */
  pending?: PendingTx
}

export interface PendingTx {
  /** signed (partially) transaction as JSON */
  json: string
  txid: string
  weight: number
  threshold: number
}

export interface TxSummary {
  txid: string
  network: NetworkId
  /** account the tx acts on */
  owner: string
  contractType: string
  /** human readable contract params (addresses base58, amounts in TRX where known) */
  params: [string, string][]
  permissionId: number
  permissionName: string
  note?: string
  expiration: number
  expired: boolean
  signatures: number
  /** base58 addresses that already signed */
  approved: string[]
  weight: number
  threshold: number
  keys: PermissionKey[]
  /** ENOUGH_PERMISSION when it can be broadcast */
  status: string
  statusMessage?: string
}

export interface SR {
  address: string
  name: string
  votes: number
}

export interface PermissionKey {
  address: string
  weight: number
}

export interface Permission {
  type: number
  id?: number
  permission_name: string
  threshold: number
  operations?: string
  keys: PermissionKey[]
}

export interface AccountPermissions {
  owner: Permission | null
  witness: Permission | null
  actives: Permission[]
}

export type TxAction =
  | 'sendTrx'
  | 'sendUsdt'
  | 'stake'
  | 'unstake'
  | 'withdrawUnfrozen'
  | 'cancelUnstakes'
  | 'delegate'
  | 'undelegate'
  | 'vote'
  | 'claimRewards'
  | 'updatePermissions'

export interface RewardInfo {
  /** TRX */
  claimable: number
  /** ms timestamps; 0 when never claimed */
  lastClaim: number
  nextClaim: number
}

export interface FeeEstimate {
  bytes: number
  /** how the bandwidth is paid */
  bandwidth: { source: 'staked' | 'free' | 'burn'; available: { staked: number; free: number }; burnTrx: number }
  energy: { required: number; available: number; burnTrx: number }
  /** extra fixed fees in TRX */
  fees: { label: string; trx: number }[]
  totalTrx: number
  warnings: string[]
}

/** Tx type key used by the history filters, see shared/txtypes.ts (e.g. 'transfer', 'delegate', 'account-create'). */
export type HistoryKind = string

export interface HistoryItem {
  txid: string
  time: number
  /** raw contract type without the "Contract" suffix, or "<SYMBOL> transfer" for TRC20 */
  type: string
  kind: HistoryKind
  direction: 'in' | 'out' | 'self' | 'other'
  counterparty?: string
  /** display text, e.g. "25 trx", "1500 votes" */
  amount?: string
  /** numeric amount + unit ("trx", token symbol in lower case, "votes"…) */
  value?: number
  unit?: string
  /** TRC20 token contract (base58) for token transfers */
  tokenContract?: string
  /** true only for the network's real USDT contract (scam tokens also use the USDT symbol) */
  isUsdt?: boolean
  /** +1 received, -1 sent, 0 neither (stake, vote, self…) — only set for transfers and tokens */
  sign: 1 | -1 | 0
  result: string
  /** true when this address sent the tx, i.e. paid its fees */
  paidByMe: boolean
  /** total TRX burned; `fees` says why */
  feeTrx: number
  fees: FeeSplit
  /** a TRX transfer that created the receiving account */
  createdAccount?: boolean
  energy: number
  bandwidth: number
  note?: string
}

export interface BalancePoint {
  /** YYYY-MM-DD (UTC) */
  day: string
  trx: number
}

export interface BalanceHistory {
  points: BalancePoint[]
  source: string
}

export interface HistoryFeedStatus {
  feed: 'all' | 'trc20' | 'usdt'
  /** rows cached */
  count: number
  /** newest / oldest block time cached (ms) */
  newest?: number
  oldest?: number
  /** backfill reached the account's first tx */
  complete: boolean
  syncedAt?: number
}

/** What the history tab asks for: range, filters and one page. Everything is computed in the main process. */
export interface HistoryQuery {
  days: number
  filters: Filters
  page: number
  pageSize: number
  /** current USDT balance (for rebuilding the daily USDT series); null when the network has none */
  usdtBalance: number | null
}

export interface HistoryQueryResult {
  /** the requested page of the filtered rows, newest first */
  rows: HistoryItem[]
  page: number
  pageSize: number
  /** rows matching range + filters */
  total: number
  /** rows in the range (before filters) */
  rangeTotal: number
  /** rows cached for the account */
  cachedTotal: number
  /** tx type counts in the range (for the filter chips) */
  counts: [string, number][]
  totals: Totals
  buckets: FeeBucket[]
  weekly: boolean
  usdt: { points: { day: string; value: number }[]; count: number; cutFrom?: string }
  status: HistoryFeedStatus[]
  syncing: boolean
  source?: { host: string; fallback: boolean }
  /** sqlite file */
  path: string
}

/** A tx in a new block that touches one of the watched addresses (live mode). */
export interface LiveActivity {
  network: NetworkId
  block: number
  time: number
  txid: string
  /** contract type without "Contract" */
  type: string
  /** the watched address involved */
  address: string
  direction: 'in' | 'out'
  counterparty?: string
  /** TRX transfers and USDT transfers */
  amount?: number
  unit?: string
  result?: string
}

export interface LiveStatus {
  enabled: boolean
  /** last tick succeeded */
  ok: boolean
  network?: NetworkId
  block?: number
  blockTime?: number
  error?: string
}

export interface HistoryProgress {
  address: string
  network: NetworkId
  feed: 'all' | 'trc20' | 'usdt'
  added: number
  phase: 'new' | 'older'
}

export interface TxReceipt {
  found: boolean
  result?: string
  feeTrx?: number
  energy?: number
  bandwidth?: number
  block?: number
}

export interface TxOptions {
  permissionId?: number
  /** key ids that sign; defaults to the account's own key */
  signers?: number[]
  /** memo stored in raw_data.data (utf8) */
  note?: string
  /** tx lifetime in minutes (default ~1). Use more when collecting signatures. Max 1440. */
  expireMinutes?: number
}

export interface NodeConfig {
  id: string
  name: string
  network: NetworkId
  fullHost: string
  apiKey?: string
  /**
   * Where the key goes. 'header' (default): sent as `apiKeyHeader`.
   * 'url': replaces `{key}` in fullHost, or is appended as `/<key>` (GetBlock, Chainstack, Ankr style).
   */
  apiKeyIn?: 'header' | 'url'
  /** Header used to send apiKey. Defaults to TRON-PRO-API-KEY (TronGrid). */
  apiKeyHeader?: string
  builtin?: boolean
}

export interface NodeState {
  nodes: NodeConfig[]
  selected: Record<NetworkId, string>
  path: string
  /** TRONGRID_API_KEY env var is set (used by built-in TronGrid nodes without a saved key) */
  envKey: boolean
}

export interface NodeTestResult {
  ok: boolean
  latencyMs: number
  block?: number
  error?: string
}

export interface Api {
  listKeys(): Promise<{ keys: PublicKey[]; error?: string; path: string }>
  vaultStatus(): Promise<VaultStatus>
  vaultCreate(password: string): Promise<VaultStatus>
  vaultUnlock(password: string): Promise<VaultStatus>
  vaultLock(): Promise<VaultStatus>
  vaultChangePassword(oldPw: string, newPw: string): Promise<VaultStatus>
  listMnemonics(): Promise<MnemonicInfo[]>
  createMnemonic(name: string, words: 12 | 24, passphrase?: string): Promise<{ id: string; phrase: string }>
  importMnemonic(name: string, phrase: string, passphrase?: string): Promise<MnemonicInfo[]>
  deriveNext(mnemonicId: string, count: number, labelPrefix?: string): Promise<PublicKey[]>
  createRandomKey(label: string): Promise<PublicKey>
  importPrivateKey(label: string, privateKey: string): Promise<PublicKey>
  addWatchOnly(label: string, address: string): Promise<PublicKey>
  importKeysFile(): Promise<{ added: number; skipped: number }>
  renameKey(id: number, label: string): Promise<void>
  deleteKey(id: number): Promise<void>
  revealPrivateKey(id: number, password: string): Promise<string>
  revealMnemonic(id: string, password: string): Promise<{ phrase: string; passphrase?: string }>
  onVaultChanged(cb: () => void): () => void
  listNodes(): Promise<NodeState>
  saveNode(node: NodeConfig): Promise<NodeState>
  deleteNode(id: string): Promise<NodeState>
  selectNode(network: NetworkId, id: string): Promise<NodeState>
  testNode(node: NodeConfig): Promise<NodeTestResult>
  getNetwork(): Promise<NetworkId>
  setNetwork(n: NetworkId): Promise<NetworkId>
  balances(address: string): Promise<Balances>
  listSRs(): Promise<SR[]>
  getPermissions(address: string): Promise<AccountPermissions>
  sendTrx(id: number, to: string, amount: number, opts?: TxOptions): Promise<TxResult>
  sendUsdt(id: number, to: string, amount: number, opts?: TxOptions): Promise<TxResult>
  stake(id: number, amount: number, resource: Resource, opts?: TxOptions): Promise<TxResult>
  unstake(id: number, amount: number, resource: Resource, opts?: TxOptions): Promise<TxResult>
  withdrawUnfrozen(id: number, opts?: TxOptions): Promise<TxResult>
  cancelUnstakes(id: number, opts?: TxOptions): Promise<TxResult>
  delegationInfo(address: string): Promise<DelegationInfo>
  getMemoFee(): Promise<number>
  estimateTx(action: TxAction, id: number, args: unknown[], opts?: TxOptions): Promise<FeeEstimate>
  rewardInfo(address: string): Promise<RewardInfo>
  claimRewards(id: number, opts?: TxOptions): Promise<TxResult>
  /** one page of cached history plus totals / chart data for the range and filters (instant, from the cache) */
  historyQuery(address: string, q: HistoryQuery): Promise<HistoryQueryResult>
  /** fetch new txs and continue loading older ones; resolves when done */
  historySync(address: string): Promise<HistoryFeedStatus[]>
  historyStop(address: string): Promise<void>
  historyClear(address: string): Promise<void>
  onHistoryProgress(cb: (p: HistoryProgress) => void): () => void
  liveSet(on: boolean, addresses: string[]): Promise<LiveStatus>
  onLiveStatus(cb: (s: LiveStatus) => void): () => void
  onLiveActivity(cb: (hits: LiveActivity[]) => void): () => void
  onLiveGap(cb: (g: { network: NetworkId; from: number; to: number }) => void): () => void
  balanceHistory(address: string, days: number): Promise<BalanceHistory>
  txReceipt(txid: string): Promise<TxReceipt>
  inspectTx(json: string): Promise<TxSummary>
  signTx(json: string, signerIds: number[]): Promise<{ json: string; summary: TxSummary }>
  broadcastTx(json: string): Promise<TxResult>
  delegate(
    id: number,
    receiver: string,
    amount: number,
    resource: Resource,
    lockPeriodBlocks: number,
    opts?: TxOptions
  ): Promise<TxResult>
  undelegate(id: number, receiver: string, amount: number, resource: Resource, opts?: TxOptions): Promise<TxResult>
  vote(id: number, votes: Record<string, number>, opts?: TxOptions): Promise<TxResult>
  updatePermissions(
    id: number,
    owner: Permission,
    actives: Permission[],
    opts?: TxOptions
  ): Promise<TxResult>
}
