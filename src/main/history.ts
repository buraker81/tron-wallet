/**
 * Account history from the TronGrid v1 API (/v1/accounts/{address}/transactions[/trc20]).
 * Plain java-tron nodes don't serve these endpoints, so a non-TronGrid active node falls back to the
 * built-in TronGrid host of the same network.
 */
import { TronWeb } from 'tronweb'
import { NETWORKS } from './networks'
import { activeNode, nodeHeaders } from './nodes'
import { SUN, getNetwork, toBase58, tw } from './client'
import type { HistoryItem, HistoryPage, TxReceipt } from '../shared/types'

const PAGE = 30

function source(): { base: string; headers: Record<string, string>; fallback: boolean } {
  const node = activeNode(getNetwork())
  const isGrid = /(^|\.)trongrid\.io$/i.test(new URL(node.fullHost).hostname)
  return isGrid
    ? { base: node.fullHost, headers: nodeHeaders(node), fallback: false }
    : { base: NETWORKS[getNetwork()].fullHost, headers: {}, fallback: true }
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

function fromTx(me: string, d: any): HistoryItem {
  const c = d.raw_data?.contract?.[0]
  const v = c?.parameter?.value ?? {}
  const owner = v.owner_address ? toBase58(v.owner_address) : undefined
  let to = v.to_address ? toBase58(v.to_address) : v.receiver_address ? toBase58(v.receiver_address) : undefined
  let amount: string | undefined
  const type = String(c?.type ?? 'Unknown').replace(/Contract$/, '')
  if (v.amount !== undefined) amount = `${v.amount / SUN} trx`
  else if (v.frozen_balance !== undefined) amount = `${v.frozen_balance / SUN} trx`
  else if (v.unfreeze_balance !== undefined) amount = `${v.unfreeze_balance / SUN} trx`
  else if (v.balance !== undefined) amount = `${v.balance / SUN} trx ${String(v.resource ?? 'BANDWIDTH').toLowerCase()}`
  else if (v.votes) amount = `${v.votes.reduce((s: number, x: any) => s + x.vote_count, 0)} votes`
  if (c?.type === 'TriggerSmartContract') {
    to = v.contract_address ? toBase58(v.contract_address) : undefined
    if (typeof v.data === 'string' && v.data.startsWith('a9059cbb')) amount = 'token transfer'
  }
  return {
    txid: d.txID,
    time: d.block_timestamp,
    type,
    // txs started by someone else that list this address (votes for an SR, delegations to us…) count as incoming
    direction: owner === me ? dir(me, owner, to) : 'in',
    counterparty: owner === me ? to : owner,
    amount,
    result: d.ret?.[0]?.contractRet ?? 'SUCCESS',
    feeTrx: Number(d.ret?.[0]?.fee ?? 0) / SUN,
    energy: Number(d.energy_usage_total ?? 0),
    bandwidth: Number(d.net_usage ?? 0),
    note: utf8(d.raw_data?.data)
  }
}

function fromTrc20(me: string, d: any): HistoryItem {
  const dec = Number(d.token_info?.decimals ?? 0)
  const value = Number(BigInt(d.value ?? '0')) / 10 ** dec
  return {
    txid: d.transaction_id,
    time: d.block_timestamp,
    type: `${d.token_info?.symbol ?? 'TRC20'} ${String(d.type ?? 'Transfer').toLowerCase()}`,
    direction: dir(me, d.from, d.to),
    counterparty: d.from === me ? d.to : d.from,
    amount: `${value} ${String(d.token_info?.symbol ?? '').toLowerCase()}`,
    result: 'SUCCESS',
    feeTrx: 0,
    energy: 0,
    bandwidth: 0
  }
}

export async function history(address: string, kind: 'all' | 'trc20', fingerprint?: string): Promise<HistoryPage> {
  if (!TronWeb.isAddress(address)) throw new Error('Invalid address')
  const { base, headers, fallback } = source()
  const url = new URL(`${base}/v1/accounts/${address}/transactions${kind === 'trc20' ? '/trc20' : ''}`)
  url.searchParams.set('limit', String(PAGE))
  if (fingerprint) url.searchParams.set('fingerprint', fingerprint)
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`History request failed: HTTP ${res.status}`)
  const body: any = await res.json()
  if (body?.success === false) throw new Error(body?.error ?? 'History request failed')
  const items = (body.data ?? [])
    .filter((d: any) => kind === 'trc20' || d.raw_data) // skip internal txs in the mixed feed
    .map((d: any) => (kind === 'trc20' ? fromTrc20(address, d) : fromTx(address, d)))
  return { items, next: body.meta?.fingerprint, source: new URL(base).host, fallback }
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
