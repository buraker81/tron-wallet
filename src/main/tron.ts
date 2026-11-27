import { TronWeb } from 'tronweb'
import { getKey } from './key'
import { NETWORKS } from './networks'
import { activeNode, nodeHeaders } from './nodes'
import type {
  AccountPermissions,
  Balances,
  Delegation,
  DelegationInfo,
  NetworkId,
  Permission,
  Resource,
  SR,
  TxOptions,
  TxResult
} from '../shared/types'

const SUN = 1_000_000

let current: NetworkId = 'shasta'

export const getNetwork = (): NetworkId => current
export function setNetwork(n: NetworkId): NetworkId {
  if (!NETWORKS[n]) throw new Error(`Unknown network: ${n}`)
  current = n
  return current
}

function tw(privateKey?: string): TronWeb {
  const node = activeNode(current)
  return new TronWeb({ fullHost: node.fullHost, headers: nodeHeaders(node), privateKey })
}

const toBase58 = (addr: string): string =>
  addr.startsWith('T') ? addr : TronWeb.address.fromHex(addr)

const permIdOpt = (opts?: TxOptions) =>
  opts?.permissionId !== undefined && opts.permissionId !== null && !Number.isNaN(opts.permissionId)
    ? { permissionId: opts.permissionId }
    : {}

/** Sign + broadcast an unsigned tx built with the given key. */
async function broadcast(t: TronWeb, tx: any, pk: string): Promise<TxResult> {
  const signed = await t.trx.sign(tx, pk)
  const res: any = await t.trx.sendRawTransaction(signed)
  const txid = res?.txid ?? res?.transaction?.txID ?? tx.txID
  if (res?.result) return { txid, ok: true }
  let message = res?.code ? String(res.code) : 'Broadcast failed'
  if (res?.message) {
    try {
      message += `: ${Buffer.from(res.message, 'hex').toString('utf8')}`
    } catch {
      message += `: ${res.message}`
    }
  }
  return { txid, ok: false, message }
}

/** Load key, create a TronWeb bound to it, run builder, broadcast. */
async function withKey(
  id: number,
  build: (t: TronWeb, address: string) => Promise<any>
): Promise<TxResult> {
  const key = getKey(id)
  const t = tw(key.privateKey)
  const tx = await build(t, key.address)
  return broadcast(t, tx, key.privateKey)
}

// ---------- reads ----------

async function usdtBalance(t: TronWeb, address: string): Promise<number | null> {
  try {
    const res: any = await t.transactionBuilder.triggerConstantContract(
      NETWORKS[current].usdt,
      'balanceOf(address)',
      {},
      [{ type: 'address', value: address }],
      address
    )
    const hex = res?.constant_result?.[0]
    if (!hex) return null
    return Number(BigInt('0x' + hex)) / SUN
  } catch {
    return null
  }
}

export async function balances(address: string): Promise<Balances> {
  const t = tw()
  const [account, res, usdt]: [any, any, number | null] = await Promise.all([
    t.trx.getAccount(address),
    t.trx.getAccountResources(address).catch(() => ({})),
    usdtBalance(t, address)
  ])
  const activated = !!account && Object.keys(account).length > 0
  return {
    address,
    activated,
    trx: (account?.balance ?? 0) / SUN,
    usdt,
    energy: { used: res?.EnergyUsed ?? 0, limit: res?.EnergyLimit ?? 0 },
    bandwidth: {
      used: (res?.freeNetUsed ?? 0) + (res?.NetUsed ?? 0),
      limit: (res?.freeNetLimit ?? 0) + (res?.NetLimit ?? 0)
    },
    frozen: (account?.frozenV2 ?? [])
      .filter((f: any) => f.amount && (f.type ?? 'BANDWIDTH') !== 'TRON_POWER')
      .map((f: any) => ({ type: (f.type ?? 'BANDWIDTH') as Resource, amount: f.amount / SUN })),
    unfreezing: (account?.unfrozenV2 ?? []).map((u: any) => ({
      amount: (u.unfreeze_amount ?? 0) / SUN,
      expireAt: u.unfreeze_expire_time ?? 0
    })),
    tronPower: res?.tronPowerLimit ?? 0,
    delegatedOut: {
      energy: (account?.account_resource?.delegated_frozenV2_balance_for_energy ?? 0) / SUN,
      bandwidth: (account?.delegated_frozenV2_balance_for_bandwidth ?? 0) / SUN
    },
    delegatedIn: {
      energy: (account?.account_resource?.acquired_delegated_frozenV2_balance_for_energy ?? 0) / SUN,
      bandwidth: (account?.acquired_delegated_frozenV2_balance_for_bandwidth ?? 0) / SUN
    },
    votes: (account?.votes ?? []).map((v: any) => ({
      address: toBase58(v.vote_address),
      count: v.vote_count
    }))
  }
}

export async function listSRs(): Promise<SR[]> {
  const list: any[] = await tw().trx.listSuperRepresentatives()
  return list
    .map((w) => ({
      address: toBase58(w.address),
      name: w.url || toBase58(w.address),
      votes: w.voteCount ?? 0
    }))
    .sort((a, b) => b.votes - a.votes)
}

function normPerm(p: any): Permission | null {
  if (!p) return null
  return {
    type: p.type === 'Owner' ? 0 : p.type === 'Witness' ? 1 : p.type === 'Active' ? 2 : (p.type ?? 0),
    id: p.id ?? 0,
    permission_name: p.permission_name,
    threshold: p.threshold ?? 1,
    operations: p.operations,
    keys: (p.keys ?? []).map((k: any) => ({ address: toBase58(k.address), weight: k.weight }))
  }
}

/** Split one getDelegatedResourceV2 record into per-resource rows. */
function delegationRows(records: any[], other: (r: any) => string): Delegation[] {
  const rows: Delegation[] = []
  for (const r of records ?? []) {
    if (r.frozen_balance_for_energy) {
      rows.push({ address: other(r), resource: 'ENERGY', amount: r.frozen_balance_for_energy / SUN, lockedUntil: r.expire_time_for_energy ?? 0 })
    }
    if (r.frozen_balance_for_bandwidth) {
      rows.push({ address: other(r), resource: 'BANDWIDTH', amount: r.frozen_balance_for_bandwidth / SUN, lockedUntil: r.expire_time_for_bandwidth ?? 0 })
    }
  }
  return rows
}

export async function delegationInfo(address: string): Promise<DelegationInfo> {
  const t = tw()
  const [index, maxE, maxB, params]: any[] = await Promise.all([
    t.trx.getDelegatedResourceAccountIndexV2(address),
    t.trx.getCanDelegatedMaxSize(address, 'ENERGY').catch(() => ({})),
    t.trx.getCanDelegatedMaxSize(address, 'BANDWIDTH').catch(() => ({})),
    t.trx.getChainParameters().catch(() => [])
  ])
  const [outs, ins] = await Promise.all([
    Promise.all((index?.toAccounts ?? []).map((to: string) => t.trx.getDelegatedResourceV2(address, to))),
    Promise.all((index?.fromAccounts ?? []).map((from: string) => t.trx.getDelegatedResourceV2(from, address)))
  ])
  return {
    out: outs.flatMap((r: any) => delegationRows(r?.delegatedResource, (x) => toBase58(x.to))),
    in: ins.flatMap((r: any) => delegationRows(r?.delegatedResource, (x) => toBase58(x.from))),
    maxDelegatable: { energy: (maxE?.max_size ?? 0) / SUN, bandwidth: (maxB?.max_size ?? 0) / SUN },
    maxLockPeriodBlocks: params.find((p: any) => p.key === 'getMaxDelegateLockPeriod')?.value ?? 86400
  }
}

export async function getPermissions(address: string): Promise<AccountPermissions> {
  const account: any = await tw().trx.getAccount(address)
  return {
    owner: normPerm(account?.owner_permission),
    witness: normPerm(account?.witness_permission),
    actives: (account?.active_permission ?? []).map(normPerm).filter(Boolean) as Permission[]
  }
}

// ---------- writes ----------

export const sendTrx = (id: number, to: string, amount: number, opts?: TxOptions) =>
  withKey(id, (t, from) =>
    t.transactionBuilder.sendTrx(to, Math.round(amount * SUN), from, permIdOpt(opts))
  )

export const sendUsdt = (id: number, to: string, amount: number, opts?: TxOptions) =>
  withKey(id, async (t, from) => {
    const { transaction } = await t.transactionBuilder.triggerSmartContract(
      NETWORKS[current].usdt,
      'transfer(address,uint256)',
      { feeLimit: 100 * SUN, ...permIdOpt(opts) },
      [
        { type: 'address', value: to },
        { type: 'uint256', value: BigInt(Math.round(amount * SUN)).toString() }
      ],
      from
    )
    return transaction
  })

export const stake = (id: number, amount: number, resource: Resource, opts?: TxOptions) =>
  withKey(id, (t, from) =>
    t.transactionBuilder.freezeBalanceV2(Math.round(amount * SUN), resource, from, permIdOpt(opts))
  )

export const unstake = (id: number, amount: number, resource: Resource, opts?: TxOptions) =>
  withKey(id, (t, from) =>
    t.transactionBuilder.unfreezeBalanceV2(Math.round(amount * SUN), resource, from, permIdOpt(opts))
  )

export const withdrawUnfrozen = (id: number, opts?: TxOptions) =>
  withKey(id, (t, from) => t.transactionBuilder.withdrawExpireUnfreeze(from, permIdOpt(opts)))

export const cancelUnstakes = (id: number, opts?: TxOptions) =>
  withKey(id, (t, from) => t.transactionBuilder.cancelUnfreezeBalanceV2(from, permIdOpt(opts)))

export const delegate = (
  id: number,
  receiver: string,
  amount: number,
  resource: Resource,
  lockPeriodBlocks: number,
  opts?: TxOptions
) =>
  withKey(id, (t, from) =>
    t.transactionBuilder.delegateResource(
      Math.round(amount * SUN),
      receiver,
      resource,
      from,
      lockPeriodBlocks > 0,
      lockPeriodBlocks > 0 ? Math.floor(lockPeriodBlocks) : undefined,
      permIdOpt(opts)
    )
  )

export const undelegate = (id: number, receiver: string, amount: number, resource: Resource, opts?: TxOptions) =>
  withKey(id, (t, from) =>
    t.transactionBuilder.undelegateResource(Math.round(amount * SUN), receiver, resource, from, permIdOpt(opts))
  )

export const vote = (id: number, votes: Record<string, number>, opts?: TxOptions) =>
  withKey(id, (t, from) => t.transactionBuilder.vote(votes, from, permIdOpt(opts)))

export const updatePermissions = (
  id: number,
  owner: Permission,
  actives: Permission[],
  opts?: TxOptions
) =>
  withKey(id, (t, from) =>
    t.transactionBuilder.updateAccountPermissions(
      from,
      owner as any,
      null,
      actives as any,
      permIdOpt(opts)
    )
  )

export const explorerUrl = (txid: string) => NETWORKS[current].explorer + txid
