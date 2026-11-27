/**
 * Account history from the TronGrid v1 API (/v1/accounts/{address}/transactions[/trc20]).
 * Plain java-tron nodes don't serve these endpoints, so a non-TronGrid active node falls back to the
 * built-in TronGrid host of the same network.
 */
import { TronWeb } from 'tronweb'
import { activeNode, builtinNode, nodeHeaders, nodePolicy, nodeQueueKey, nodeUrl } from './nodes'
import { checkedFetch, throttled } from './ratelimit'
import { SUN, getNetwork, toBase58, tw } from './client'
import { NETWORKS } from './networks'
import { ZERO_FEES, typeKey, type FeeSplit } from '../shared/txtypes'
import type {
  BalanceHistory,
  BalancePoint,
  HistoryItem,
  HistoryKind,
  HistoryPage,
  NodeConfig,
  TxReceipt
} from '../shared/types'

const PAGE = 200

function source(): { node: NodeConfig; fallback: boolean } {
  const node = activeNode(getNetwork())
  const isGrid = /(^|\.)trongrid\.io$/i.test(new URL(node.fullHost.replace('{key}', 'k')).hostname)
  // non-TronGrid nodes have no v1 API: use the built-in TronGrid node (with its saved key, if any)
  return isGrid ? { node, fallback: false } : { node: builtinNode(getNetwork()), fallback: true }
}

const dir = (me: string, from?: string, to?: string): HistoryItem['direction'] =>
  from === me && to === me ? 'self' : from === me ? 'out' : to === me ? 'in' : 'other'

const utf8 = (hex?: string) => {
  if (!hex) return undefined
  try {
    return Buffer.from(hex, 'hex').toString('utf8')
  } catch {
    return undefined
  }
}

const sun = (v: unknown) => Number(v ?? 0) / SUN
const round = (n: number) => Math.round(n * SUN) / SUN

interface FeeParams {
  createAccount: number // bandwidth fee when creating an account (0.1 TRX)
  createNewAccount: number // system fee for a new account (1 TRX)
  memo: number
  multisig: number
  permission: number
}

const paramCache = new Map<string, { at: number; p: FeeParams }>()

/** Current fee parameters of the network (cached 10 min). Used to explain what each burned TRX was for. */
async function feeParams(): Promise<FeeParams> {
  const net = getNetwork()
  const hit = paramCache.get(net)
  if (hit && Date.now() - hit.at < 600_000) return hit.p
  const list: any[] = await tw().trx.getChainParameters()
  const v = (k: string, d: number) => sun(list.find((x) => x.key === k)?.value ?? d)
  const p: FeeParams = {
    createAccount: v('getCreateAccountFee', 100_000),
    createNewAccount: v('getCreateNewAccountFeeInSystemContract', 1_000_000),
    memo: v('getMemoFee', 1_000_000),
    multisig: v('getMultiSignFee', 1_000_000),
    permission: v('getUpdateAccountPermissionFee', 100_000_000)
  }
  paramCache.set(net, { at: Date.now(), p })
  return p
}

/**
 * Split a tx's burned TRX by cause. TronGrid gives total fee, net_fee (bandwidth) and energy_fee; the rest is
 * attributed from the tx itself: memo (raw_data.data), multi-signature (> 1 signature), permission update,
 * account creation (TRX transfer / AccountCreate whose remaining fee covers the system fee; its 0.1 TRX
 * bandwidth fee is moved from bandwidth to account creation). Whatever is left is "other".
 */
function splitFees(d: any, contract: string, p: FeeParams): { fees: FeeSplit; createdAccount: boolean } {
  const fee = sun(d.ret?.[0]?.fee)
  let bandwidth = sun(d.net_fee)
  const energy = sun(d.energy_fee)
  let rest = round(fee - bandwidth - energy)
  const take = (amount: number, when: boolean) => {
    if (!when || amount <= 0 || rest + 1e-9 < amount) return 0
    rest = round(rest - amount)
    return amount
  }
  const memo = take(p.memo, !!d.raw_data?.data)
  const multisig = take(p.multisig, (d.signature?.length ?? 0) > 1)
  const permission = take(p.permission, contract === 'AccountPermissionUpdate')
  let activation = take(p.createNewAccount, contract === 'Transfer' || contract === 'AccountCreate' || contract === 'TransferAsset')
  const createdAccount = activation > 0
  if (createdAccount && Math.abs(bandwidth - p.createAccount) < 1e-9) {
    // creating an account burns getCreateAccountFee as bandwidth when the sender has no staked bandwidth
    activation = round(activation + bandwidth)
    bandwidth = 0
  }
  return {
    fees: { bandwidth, energy, activation, memo, multisig, permission, other: Math.max(0, rest) },
    createdAccount
  }
}

function fromTx(me: string, d: any, p: FeeParams): HistoryItem {
  const c = d.raw_data?.contract?.[0]
  const v = c?.parameter?.value ?? {}
  const owner = v.owner_address ? toBase58(v.owner_address) : undefined
  let to = v.to_address ? toBase58(v.to_address) : v.receiver_address ? toBase58(v.receiver_address) : undefined
  if (!to && v.account_address) to = toBase58(v.account_address) // AccountCreate
  const type = String(c?.type ?? 'Unknown').replace(/Contract$/, '')
  const { fees, createdAccount } = splitFees(d, type, p)
  const kind: HistoryKind = createdAccount || type === 'AccountCreate' ? 'account-create' : typeKey(type)
  let value: number | undefined
  let unit: string | undefined
  let amount: string | undefined
  if (type === 'TransferAsset') {
    value = Number(v.amount ?? 0)
    unit = 'trc10'
  } else if (v.amount !== undefined) {
    value = sun(v.amount)
    unit = 'trx'
  } else if (v.frozen_balance !== undefined) {
    value = sun(v.frozen_balance)
    unit = 'trx'
  } else if (v.unfreeze_balance !== undefined) {
    value = sun(v.unfreeze_balance)
    unit = 'trx'
  } else if (v.balance !== undefined) {
    value = sun(v.balance)
    unit = 'trx'
    amount = `${value} trx ${String(v.resource ?? 'BANDWIDTH').toLowerCase()}`
  } else if (v.votes) {
    value = v.votes.reduce((s: number, x: any) => s + x.vote_count, 0)
    unit = 'votes'
  }
  if (type === 'TriggerSmart') {
    to = v.contract_address ? toBase58(v.contract_address) : undefined
    value = undefined
    unit = undefined
    // the TRC20 feed enriches this row with the decoded token amount (merged by txid in the UI)
    if (typeof v.data === 'string' && v.data.startsWith('a9059cbb')) amount = 'token transfer'
  }
  if (amount === undefined && value !== undefined) amount = `${value} ${unit}`

  // txs started by someone else that list this address (votes for an SR, delegations to us…) count as incoming
  const direction = owner === me ? dir(me, owner, to) : 'in'
  const moves = type === 'Transfer' || type === 'TransferAsset'
  const sign: HistoryItem['sign'] = !moves || direction === 'self' ? 0 : direction === 'out' ? -1 : 1

  return {
    txid: d.txID,
    time: d.block_timestamp,
    type,
    kind,
    direction,
    counterparty: owner === me ? to : owner,
    amount,
    value,
    unit,
    sign,
    result: d.ret?.[0]?.contractRet ?? 'SUCCESS',
    paidByMe: owner === me,
    feeTrx: sun(d.ret?.[0]?.fee),
    fees,
    createdAccount,
    energy: Number(d.energy_usage_total ?? 0),
    bandwidth: Number(d.net_usage ?? 0),
    note: utf8(d.raw_data?.data)
  }
}

function fromTrc20(me: string, d: any): HistoryItem {
  const dec = Number(d.token_info?.decimals ?? 0)
  const value = Number(BigInt(d.value ?? '0')) / 10 ** dec
  const symbol = String(d.token_info?.symbol ?? 'TRC20')
  const direction = dir(me, d.from, d.to)
  return {
    txid: d.transaction_id,
    time: d.block_timestamp,
    type: `${symbol} ${String(d.type ?? 'Transfer').toLowerCase()}`,
    kind: 'trc20',
    direction,
    counterparty: d.from === me ? d.to : d.from,
    amount: `${value} ${symbol.toLowerCase()}`,
    value,
    unit: symbol.toLowerCase(),
    sign: direction === 'out' ? -1 : direction === 'in' ? 1 : 0,
    tokenContract: d.token_info?.address,
    isUsdt: d.token_info?.address === NETWORKS[getNetwork()].usdt,
    result: 'SUCCESS',
    // fees are on the contract call itself (the 'all' feed row with the same txid)
    paidByMe: d.from === me,
    feeTrx: 0,
    fees: { ...ZERO_FEES },
    energy: 0,
    bandwidth: 0
  }
}

/**
 * One page of history. For the TRC20 feed, `opts.usdtOnly` limits it to the network's USDT contract and
 * `opts.since` (ms) stops at that time, so the USDT balance chart can cover its whole range without loading
 * every other transfer.
 */
export async function history(
  address: string,
  kind: 'all' | 'trc20',
  fingerprint?: string,
  opts?: { usdtOnly?: boolean; since?: number }
): Promise<HistoryPage> {
  if (!TronWeb.isAddress(address)) throw new Error('Invalid address')
  const { node, fallback } = source()
  const base = nodeUrl(node)
  const url = new URL(`${base}/v1/accounts/${address}/transactions${kind === 'trc20' ? '/trc20' : ''}`)
  url.searchParams.set('limit', String(PAGE))
  if (fingerprint) url.searchParams.set('fingerprint', fingerprint)
  if (kind === 'trc20' && opts?.usdtOnly) url.searchParams.set('contract_address', NETWORKS[getNetwork()].usdt)
  if (opts?.since) url.searchParams.set('min_timestamp', String(Math.floor(opts.since)))
  const res = await throttled(nodeQueueKey(node), nodePolicy(node), () =>
    checkedFetch(url, { headers: nodeHeaders(node), signal: AbortSignal.timeout(15000) })
  )
  if (!res.ok) throw new Error(`History request failed: HTTP ${res.status}`)
  const body: any = await res.json()
  if (body?.success === false) throw new Error(body?.error ?? 'History request failed')
  const params = kind === 'all' ? await feeParams() : (undefined as unknown as FeeParams)
  const items = (body.data ?? [])
    .filter((d: any) => kind === 'trc20' || d.raw_data) // skip internal txs in the mixed feed
    .map((d: any) => (kind === 'trc20' ? fromTrc20(address, d) : fromTx(address, d, params)))
  return { items, next: body.meta?.fingerprint, source: new URL(node.fullHost.replace('{key}', 'k')).host, fallback }
}

/**
 * Daily TRX balance from the Tronscan account analysis API (type 0). The response's `usdt_amount` is the USD value
 * of the TRX, not a USDT balance, so only `trx_amount` is used.
 */
export async function balanceHistory(address: string, days: number): Promise<BalanceHistory> {
  if (!TronWeb.isAddress(address)) throw new Error('Invalid address')
  const host = NETWORKS[getNetwork()].tronscanApi
  const end = Date.now()
  const url = new URL(`${host}/api/account/analysis`)
  url.searchParams.set('address', address)
  url.searchParams.set('type', '0')
  url.searchParams.set('start_timestamp', String(end - Math.max(1, days) * 86_400_000))
  url.searchParams.set('end_timestamp', String(end))
  const res = await throttled(`tronscan:${new URL(host).host}`, { concurrency: 2, minIntervalMs: 200 }, () =>
    checkedFetch(url, { signal: AbortSignal.timeout(20000) })
  )
  if (!res.ok) throw new Error(`Tronscan balance history failed: HTTP ${res.status}`)
  const body: any = await res.json()
  const points: BalancePoint[] = (body?.data ?? [])
    .map((x: any) => ({ day: String(x.day), trx: Number(x.trx_amount ?? 0) }))
    .filter((x: BalancePoint) => /^\d{4}-\d{2}-\d{2}$/.test(x.day))
    .sort((a: BalancePoint, b: BalancePoint) => a.day.localeCompare(b.day))
  return { points, source: new URL(host).host }
}

/** Receipt of a mined tx (fee, energy, bandwidth). found=false while it is not in a block yet. */
export async function txReceipt(txid: string): Promise<TxReceipt> {
  const info: any = await tw().trx.getTransactionInfo(txid)
  if (!info || !info.id) return { found: false }
  return {
    found: true,
    result: info.receipt?.result ?? (info.result === 'FAILED' ? 'FAILED' : 'SUCCESS'),
    feeTrx: Number(info.fee ?? 0) / SUN,
    energy: Number(info.receipt?.energy_usage_total ?? 0),
    bandwidth: Number(info.receipt?.net_usage ?? 0),
    block: info.blockNumber
  }
}
