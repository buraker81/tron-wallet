/**
 * Live mode: follow new blocks (~3 s) and report txs that touch the watched addresses.
 *
 * Every tick fetches the latest block (getnowblock, which includes all its txs) and scans it locally, so watching
 * any number of addresses costs one request per block. Missed blocks (a slow tick) are fetched in one range call;
 * longer gaps (sleep, offline) are reported as `gap` so the UI can do a full refresh instead.
 *
 * Detected per tx: owner / to / receiver / account addresses (TRX & TRC10 transfers, stake, delegate, vote,
 * permission…), vote targets, and TRC20 transfer(to) / transferFrom(from, to) in contract call data.
 * Not detected: transfers made inside other contracts (internal txs) — the UI refreshes balances periodically.
 */
import { BrowserWindow } from 'electron'
import { TronWeb } from 'tronweb'
import { NETWORKS } from './networks'
import { SUN, getNetwork, tw } from './client'
import type { LiveActivity, LiveStatus, NetworkId } from '../shared/types'

const TICK_MS = 3000
const MAX_GAP = 20 // blocks (~1 min) fetched to fill a gap; more than that is reported as a gap

let enabled = false
let timer: NodeJS.Timeout | undefined
let watched = new Map<string, string>() // hex (lower case, 41…) → base58
let last: { network: NetworkId; block: number } | undefined
let status: LiveStatus = { enabled: false, ok: true }

const toHex = (a: string) => TronWeb.address.toHex(a).toLowerCase()
const b58 = (hex: string) => TronWeb.address.fromHex(hex)

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow?.getAllWindows?.() ?? []) w.webContents.send(channel, payload)
}

function setStatus(patch: Partial<LiveStatus>): void {
  status = { ...status, ...patch }
  send('live-status', status)
}

/** Addresses touched by one tx, with this address's role and a short description. */
function scanTx(tx: any, block: number, time: number, network: NetworkId): LiveActivity[] {
  const c = tx.raw_data?.contract?.[0]
  if (!c) return []
  const v = c.parameter?.value ?? {}
  const type = String(c.type ?? '').replace(/Contract$/, '')
  const owner = String(v.owner_address ?? '').toLowerCase()
  const parties: { hex: string; role: 'from' | 'to' }[] = []
  if (owner) parties.push({ hex: owner, role: 'from' })
  for (const k of ['to_address', 'receiver_address', 'account_address']) {
    if (v[k]) parties.push({ hex: String(v[k]).toLowerCase(), role: 'to' })
  }
  for (const vote of v.votes ?? []) parties.push({ hex: String(vote.vote_address).toLowerCase(), role: 'to' })

  let amount: number | undefined
  let unit: string | undefined
  if (type === 'Transfer') {
    amount = Number(v.amount ?? 0) / SUN
    unit = 'trx'
  }
  // TRC20 transfer(address,uint256) / transferFrom(address,address,uint256)
  const data = typeof v.data === 'string' ? v.data.toLowerCase() : ''
  const contract = String(v.contract_address ?? '').toLowerCase()
  const isUsdt = contract && contract === toHex(NETWORKS[network].usdt)
  const word = (i: number) => data.slice(8 + i * 64, 8 + (i + 1) * 64)
  if (type === 'TriggerSmart' && data.startsWith('a9059cbb') && data.length >= 136) {
    parties.push({ hex: '41' + word(0).slice(24), role: 'to' })
    if (isUsdt) {
      amount = Number(BigInt('0x' + word(1))) / 1e6
      unit = 'usdt'
    }
  } else if (type === 'TriggerSmart' && data.startsWith('23b872dd') && data.length >= 200) {
    parties.push({ hex: '41' + word(0).slice(24), role: 'from' })
    parties.push({ hex: '41' + word(1).slice(24), role: 'to' })
    if (isUsdt) {
      amount = Number(BigInt('0x' + word(2))) / 1e6
      unit = 'usdt'
    }
  }

  const out: LiveActivity[] = []
  const seen = new Set<string>()
  for (const p of parties) {
    const address = watched.get(p.hex)
    if (!address || seen.has(address)) continue
    seen.add(address)
    const other = parties.find((q) => q.hex !== p.hex && q.role !== p.role) ?? parties.find((q) => q.hex !== p.hex)
    out.push({
      network,
      block,
      time,
      txid: tx.txID,
      type,
      address,
      direction: p.role === 'from' ? 'out' : 'in',
      counterparty: other ? b58(other.hex) : undefined,
      amount,
      unit,
      result: tx.ret?.[0]?.contractRet
    })
  }
  return out
}

function scanBlock(b: any, network: NetworkId): LiveActivity[] {
  const block = Number(b.block_header?.raw_data?.number ?? 0)
  const time = Number(b.block_header?.raw_data?.timestamp ?? Date.now())
  return (b.transactions ?? []).flatMap((tx: any) => scanTx(tx, block, time, network))
}

async function tick(): Promise<void> {
  const network = getNetwork()
  const t = tw()
  try {
    const head: any = await t.trx.getCurrentBlock()
    const n = Number(head.block_header.raw_data.number)
    const prev = last && last.network === network ? last.block : undefined
    if (prev !== undefined && n <= prev) return setStatus({ ok: true, network, block: n })
    const blocks: any[] = []
    if (prev !== undefined && n - prev > 1) {
      if (n - prev - 1 <= MAX_GAP) blocks.push(...((await t.trx.getBlockRange(prev + 1, n - 1)) as any[]))
      else send('live-gap', { network, from: prev, to: n })
    }
    blocks.push(head)
    last = { network, block: n }
    const hits = watched.size ? blocks.flatMap((b) => scanBlock(b, network)) : []
    if (hits.length) send('live-activity', hits)
    setStatus({ ok: true, network, block: n, blockTime: Number(head.block_header.raw_data.timestamp), error: undefined })
  } catch (e: any) {
    setStatus({ ok: false, error: e?.message ?? String(e) })
  }
}

function loop(): void {
  if (!enabled) return
  const started = Date.now()
  tick().finally(() => {
    if (enabled) timer = setTimeout(loop, Math.max(500, TICK_MS - (Date.now() - started)))
  })
}

/** Turn live mode on/off and set the addresses to watch (base58). */
export function setLive(on: boolean, addresses: string[]): LiveStatus {
  watched = new Map(addresses.filter((a) => TronWeb.isAddress(a)).map((a) => [toHex(a), a]))
  if (on && !enabled) {
    enabled = true
    last = undefined
    setStatus({ enabled: true, ok: true, error: undefined })
    loop()
  } else if (!on && enabled) {
    enabled = false
    if (timer) clearTimeout(timer)
    setStatus({ enabled: false })
  }
  return status
}

export const liveStatus = (): LiveStatus => status

/** Scan one block for the given addresses (used by tests; live mode uses the watched set). */
export function scanForTest(block: any, addresses: string[], network: NetworkId): LiveActivity[] {
  const saved = watched
  watched = new Map(addresses.map((a) => [toHex(a), a]))
  try {
    return scanBlock(block, network)
  } finally {
    watched = saved
  }
}
