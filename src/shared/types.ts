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
  /** Header used to send apiKey. Defaults to TRON-PRO-API-KEY (TronGrid). */
  apiKeyHeader?: string
  builtin?: boolean
}

export interface NodeState {
  nodes: NodeConfig[]
  selected: Record<NetworkId, string>
  path: string
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
