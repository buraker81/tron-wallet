import { TronWeb } from 'tronweb'
import { NETWORKS } from './networks'
import { SUN, getNetwork, setNetwork, toBase58, tw } from './client'
import { execute } from './multisig'
import type {
  AccountPermissions,
  Balances,
  Delegation,
  DelegationInfo,
  Permission,
  Resource,
  SR,
  RewardInfo,
  TxAction,
  TxOptions,
  TxResult
} from '../shared/types'

export { getNetwork, setNetwork }

const permIdOpt = (opts?: TxOptions) =>
  opts?.permissionId !== undefined && opts.permissionId !== null && !Number.isNaN(opts.permissionId)
    ? { permissionId: opts.permissionId }
    : {}

/** Build with the account's address, then sign / weigh / broadcast through the shared pipeline. */
const withKey = (
  id: number,
  build: (t: TronWeb, address: string) => Promise<any>,
  opts?: TxOptions
): Promise<TxResult> => execute(id, build, opts)

// ---------- reads ----------

async function usdtBalance(t: TronWeb, address: string): Promise<number | null> {
  try {
    const res: any = await t.transactionBuilder.triggerConstantContract(
      NETWORKS[getNetwork()].usdt,
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

const sun = (trx: number) => Math.round(trx * SUN)

/**
 * Unsigned tx builders, keyed by action name. The same builder is used to send (execute) and to
 * estimate fees, so the estimate is for exactly the tx that would be signed.
 */
export const BUILDERS: Record<TxAction, (t: TronWeb, from: string, args: any[], o?: TxOptions) => Promise<any>> = {
  sendTrx: (t, from, [to, amount], o) => t.transactionBuilder.sendTrx(to, sun(amount), from, permIdOpt(o)),
  sendUsdt: async (t, from, [to, amount], o) => {
    const { transaction } = await t.transactionBuilder.triggerSmartContract(
      NETWORKS[getNetwork()].usdt,
      'transfer(address,uint256)',
      { feeLimit: USDT_FEE_LIMIT_TRX * SUN, ...permIdOpt(o) },
      [
        { type: 'address', value: to },
        { type: 'uint256', value: BigInt(sun(amount)).toString() }
      ],
      from
    )
    return transaction
  },
  stake: (t, from, [amount, resource], o) => t.transactionBuilder.freezeBalanceV2(sun(amount), resource, from, permIdOpt(o)),
  unstake: (t, from, [amount, resource], o) =>
    t.transactionBuilder.unfreezeBalanceV2(sun(amount), resource, from, permIdOpt(o)),
  withdrawUnfrozen: (t, from, _a, o) => t.transactionBuilder.withdrawExpireUnfreeze(from, permIdOpt(o)),
  cancelUnstakes: (t, from, _a, o) => t.transactionBuilder.cancelUnfreezeBalanceV2(from, permIdOpt(o)),
  delegate: (t, from, [receiver, amount, resource, lockPeriodBlocks], o) =>
    t.transactionBuilder.delegateResource(
      sun(amount),
      receiver,
      resource,
      from,
      lockPeriodBlocks > 0,
      lockPeriodBlocks > 0 ? Math.floor(lockPeriodBlocks) : undefined,
      permIdOpt(o)
    ),
  undelegate: (t, from, [receiver, amount, resource], o) =>
    t.transactionBuilder.undelegateResource(sun(amount), receiver, resource, from, permIdOpt(o)),
  vote: (t, from, [votes], o) => t.transactionBuilder.vote(votes, from, permIdOpt(o)),
  claimRewards: (t, from, _a, o) => t.transactionBuilder.withdrawBlockRewards(from, permIdOpt(o)),
  updatePermissions: (t, from, [owner, actives], o) =>
    t.transactionBuilder.updateAccountPermissions(from, owner as any, null, actives as any, permIdOpt(o))
}

export const USDT_FEE_LIMIT_TRX = 100

export const runAction = (action: TxAction, id: number, args: any[], opts?: TxOptions): Promise<TxResult> => {
  if (!BUILDERS[action]) throw new Error(`Unknown action: ${action}`)
  return withKey(id, (t, from) => BUILDERS[action](t, from, args, opts), opts)
}

export const sendTrx = (id: number, to: string, amount: number, opts?: TxOptions) =>
  runAction('sendTrx', id, [to, amount], opts)
export const sendUsdt = (id: number, to: string, amount: number, opts?: TxOptions) =>
  runAction('sendUsdt', id, [to, amount], opts)
export const stake = (id: number, amount: number, resource: Resource, opts?: TxOptions) =>
  runAction('stake', id, [amount, resource], opts)
export const unstake = (id: number, amount: number, resource: Resource, opts?: TxOptions) =>
  runAction('unstake', id, [amount, resource], opts)
export const withdrawUnfrozen = (id: number, opts?: TxOptions) => runAction('withdrawUnfrozen', id, [], opts)
export const cancelUnstakes = (id: number, opts?: TxOptions) => runAction('cancelUnstakes', id, [], opts)
export const delegate = (
  id: number,
  receiver: string,
  amount: number,
  resource: Resource,
  lockPeriodBlocks: number,
  opts?: TxOptions
) => runAction('delegate', id, [receiver, amount, resource, lockPeriodBlocks], opts)
export const undelegate = (id: number, receiver: string, amount: number, resource: Resource, opts?: TxOptions) =>
  runAction('undelegate', id, [receiver, amount, resource], opts)
export const vote = (id: number, votes: Record<string, number>, opts?: TxOptions) => runAction('vote', id, [votes], opts)
export const claimRewards = (id: number, opts?: TxOptions) => runAction('claimRewards', id, [], opts)
export const updatePermissions = (id: number, owner: Permission, actives: Permission[], opts?: TxOptions) =>
  runAction('updatePermissions', id, [owner, actives], opts)

/** Unclaimed voting rewards and when the next claim is allowed (one WithdrawBalance per 24 h). */
export async function rewardInfo(address: string): Promise<RewardInfo> {
  const t = tw()
  const [reward, account]: any[] = await Promise.all([t.trx.getReward(address).catch(() => 0), t.trx.getAccount(address)])
  const last = Number(account?.latest_withdraw_time ?? 0)
  return { claimable: Number(reward ?? 0) / SUN, lastClaim: last, nextClaim: last ? last + 86_400_000 : 0 }
}

export const explorerUrl = (txid: string) => NETWORKS[getNetwork()].explorer + txid
