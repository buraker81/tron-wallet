// Pure helpers for the history tab: merging feeds, ranges, totals and chart series. No React, easy to test.
import type { HistoryItem, HistoryKind } from '../../../../shared/types'

export const DAY = 86_400_000

export type RangeId = '30d' | '90d' | '1y' | 'all'
export const RANGES: { id: RangeId; label: string; days: number }[] = [
  { id: '30d', label: '30d', days: 30 },
  { id: '90d', label: '90d', days: 90 },
  { id: '1y', label: '1y', days: 365 },
  // Tronscan returns up to ~1000 days of daily balances
  { id: 'all', label: 'all', days: 1000 }
]

export const KIND_ORDER: HistoryKind[] = [
  'transfer',
  'token',
  'contract',
  'stake',
  'unstake',
  'withdraw',
  'delegate',
  'reclaim',
  'vote',
  'claim',
  'permission',
  'other'
]

/** UTC calendar day, the same convention Tronscan uses for its daily points. */
export const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Merge the TronGrid "all" feed and the TRC20 feed into one list (newest first).
 * Our own TRC20 sends appear in both: the contract-call row keeps its fees and gets the token details.
 * Incoming TRC20 transfers only exist in the TRC20 feed and are added as-is.
 */
export function mergeFeeds(all: HistoryItem[], trc20: HistoryItem[]): HistoryItem[] {
  const byId = new Map(all.map((x) => [x.txid, x]))
  const extra: HistoryItem[] = []
  for (const t of trc20) {
    const row = byId.get(t.txid)
    if (row && row.kind === 'contract') {
      byId.set(t.txid, {
        ...row,
        kind: 'token',
        type: t.type,
        amount: t.amount,
        value: t.value,
        unit: t.unit,
        sign: t.sign,
        direction: t.direction,
        counterparty: t.counterparty,
        tokenContract: t.tokenContract,
        isUsdt: t.isUsdt
      })
    } else if (!row) {
      extra.push(t)
    }
  }
  return [...byId.values(), ...extra].sort((a, b) => b.time - a.time)
}

export interface Filters {
  kinds: Set<HistoryKind>
  direction: 'all' | 'in' | 'out'
  result: 'all' | 'success' | 'failed'
  search: string
}

export const EMPTY_FILTERS: Filters = { kinds: new Set(), direction: 'all', result: 'all', search: '' }

export function inRange(items: HistoryItem[], days: number, now = Date.now()): HistoryItem[] {
  const from = now - days * DAY
  return items.filter((x) => x.time >= from)
}

/** labels: extra searchable text per address (your key ids / labels) */
export function applyFilters(items: HistoryItem[], f: Filters, labels: Map<string, string>): HistoryItem[] {
  const q = f.search.trim().toLowerCase()
  return items.filter((x) => {
    if (f.kinds.size && !f.kinds.has(x.kind)) return false
    if (f.direction === 'in' && x.direction !== 'in') return false
    if (f.direction === 'out' && x.direction !== 'out') return false
    if (f.result === 'success' && x.result !== 'SUCCESS') return false
    if (f.result === 'failed' && x.result === 'SUCCESS') return false
    if (!q) return true
    const hay = [x.txid, x.counterparty, x.note, x.type, x.amount, x.counterparty && labels.get(x.counterparty)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

export function kindCounts(items: HistoryItem[]): Map<HistoryKind, number> {
  const m = new Map<HistoryKind, number>()
  for (const x of items) m.set(x.kind, (m.get(x.kind) ?? 0) + 1)
  return m
}

export interface Totals {
  txs: number
  paid: number
  fee: number
  netFee: number
  energyFee: number
  otherFee: number
  energy: number
  bandwidth: number
  trxIn: number
  trxOut: number
  usdtIn: number
  usdtOut: number
  failed: number
}

/** Fees and resources count only txs this address sent (it paid for them). Flows count TRX transfers and real USDT. */
export function totals(items: HistoryItem[]): Totals {
  const t: Totals = {
    txs: items.length,
    paid: 0,
    fee: 0,
    netFee: 0,
    energyFee: 0,
    otherFee: 0,
    energy: 0,
    bandwidth: 0,
    trxIn: 0,
    trxOut: 0,
    usdtIn: 0,
    usdtOut: 0,
    failed: 0
  }
  for (const x of items) {
    if (x.result !== 'SUCCESS') t.failed++
    if (x.paidByMe) {
      t.paid++
      t.fee += x.feeTrx
      t.netFee += x.netFeeTrx
      t.energyFee += x.energyFeeTrx
      t.otherFee += x.otherFeeTrx
      t.energy += x.energy
      t.bandwidth += x.bandwidth
    }
    if (x.result !== 'SUCCESS' || !x.value) continue
    if (x.kind === 'transfer' && x.unit === 'trx') {
      if (x.sign > 0) t.trxIn += x.value
      if (x.sign < 0) t.trxOut += x.value
    }
    if (x.isUsdt) {
      if (x.sign > 0) t.usdtIn += x.value
      if (x.sign < 0) t.usdtOut += x.value
    }
  }
  return t
}

export interface SeriesPoint {
  day: string
  value: number
}

/** Every UTC day from `days` ago to today, oldest first. */
export function dayList(days: number, now = Date.now()): string[] {
  const out: string[] = []
  for (let i = days - 1; i >= 0; i--) out.push(dayKey(now - i * DAY))
  return out
}

/**
 * USDT balance at the end of each day, rebuilt backwards from the current balance:
 * balance(end of D) = current − Σ(signed USDT transfers after D).
 * Exact as long as every transfer in the window is loaded.
 */
export function usdtSeries(items: HistoryItem[], current: number, days: string[]): SeriesPoint[] {
  const perDay = new Map<string, number>()
  for (const x of items) {
    if (!x.isUsdt || x.result !== 'SUCCESS' || !x.value || !x.sign) continue
    const d = dayKey(x.time)
    perDay.set(d, (perDay.get(d) ?? 0) + x.sign * x.value)
  }
  const out: SeriesPoint[] = []
  let bal = current
  // walk newest → oldest; transfers dated after the last listed day (none, since the list ends today) are ignored
  for (let i = days.length - 1; i >= 0; i--) {
    out.push({ day: days[i], value: Math.max(0, round6(bal)) })
    bal -= perDay.get(days[i]) ?? 0
  }
  return out.reverse()
}

export interface FeeBucket {
  key: string
  /** first day of the bucket */
  start: string
  fee: number
  netFee: number
  energyFee: number
  otherFee: number
  txs: number
}

/** Fees this address paid, per day (ranges up to 120 days) or per week (longer ranges). */
export function feeBuckets(items: HistoryItem[], days: string[]): FeeBucket[] {
  const weekly = days.length > 120
  const size = weekly ? 7 : 1
  const buckets: FeeBucket[] = []
  const index = new Map<string, FeeBucket>()
  for (let i = 0; i < days.length; i += size) {
    const b: FeeBucket = { key: days[i], start: days[i], fee: 0, netFee: 0, energyFee: 0, otherFee: 0, txs: 0 }
    buckets.push(b)
    for (let j = i; j < Math.min(i + size, days.length); j++) index.set(days[j], b)
  }
  for (const x of items) {
    if (!x.paidByMe) continue
    const b = index.get(dayKey(x.time))
    if (!b) continue
    b.fee += x.feeTrx
    b.netFee += x.netFeeTrx
    b.energyFee += x.energyFeeTrx
    b.otherFee += x.otherFeeTrx
    b.txs++
  }
  return buckets
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6
