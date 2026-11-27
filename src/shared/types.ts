export type NetworkId = 'shasta' | 'nile' | 'mainnet'
export type Resource = 'ENERGY' | 'BANDWIDTH'

export interface PublicKey {
  id: number
  address: string
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
}

export interface TxResult {
  txid: string
  ok: boolean
  message?: string
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
  vote(id: number, votes: Record<string, number>, opts?: TxOptions): Promise<TxResult>
  updatePermissions(
    id: number,
    owner: Permission,
    actives: Permission[],
    opts?: TxOptions
  ): Promise<TxResult>
}
