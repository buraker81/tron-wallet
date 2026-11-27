/**
 * Local SQLite cache for account history (built-in node:sqlite, no native dependency).
 *
 * Confirmed transactions never change, so raw TronGrid rows are stored once and only new ones are fetched later.
 * Rows are kept raw (API JSON) and turned into history items when read, so fee / type rules can change without
 * re-downloading. Each (network, address, feed) has a sync state:
 *   newest   – newest block time stored          → forward sync asks only for newer rows (min_timestamp)
 *   oldest   – oldest block time stored          → backfill asks for older rows (max_timestamp)
 *   complete – backfill reached the first tx of the account
 * Backfill runs with a per-call budget; the rest continues on the next sync ("load older" / next app start).
 * Past daily balances from Tronscan are cached too (today is always refreshed).
 */
import { DatabaseSync } from 'node:sqlite'
import { BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { keysPath } from './key'
import { getNetwork } from './client'
import { balanceHistory as fetchBalanceHistory, fetchRaw, processRows, rowTime, rowUid, type Feed } from './history'
import type { BalanceHistory, HistoryData, HistoryFeedStatus, HistoryItem } from '../shared/types'

const FEEDS: Feed[] = ['all', 'trc20', 'usdt']
/** rows fetched per backfill run and feed (the USDT feed gets more: the USDT chart needs its whole range) */
const BUDGET: Record<Feed, number> = { all: 5000, trc20: 5000, usdt: 20000 }
/** re-read this much before `newest` on forward sync, in case rows with the same timestamp arrived late */
const OVERLAP_MS = 120_000

export const cachePath = (): string => process.env.CACHE_FILE || join(dirname(keysPath()), 'cache.sqlite')

let db: DatabaseSync | undefined
function open(): DatabaseSync {
  if (db) return db
  db = new DatabaseSync(cachePath())
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS rows (
      network TEXT NOT NULL, address TEXT NOT NULL, feed TEXT NOT NULL, uid TEXT NOT NULL,
      time INTEGER NOT NULL, raw TEXT NOT NULL,
      PRIMARY KEY (network, address, feed, uid)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS rows_by_time ON rows (network, address, feed, time);
    CREATE TABLE IF NOT EXISTS sync (
      network TEXT NOT NULL, address TEXT NOT NULL, feed TEXT NOT NULL,
      newest INTEGER, oldest INTEGER, complete INTEGER NOT NULL DEFAULT 0, synced_at INTEGER,
      PRIMARY KEY (network, address, feed)
    );
    CREATE TABLE IF NOT EXISTS balance_days (
      network TEXT NOT NULL, address TEXT NOT NULL, day TEXT NOT NULL, trx REAL NOT NULL,
      PRIMARY KEY (network, address, day)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS balance_sync (
      network TEXT NOT NULL, address TEXT NOT NULL, from_day TEXT NOT NULL, source TEXT,
      PRIMARY KEY (network, address)
    );
  `)
  return db
}

// ---------- sync state ----------

function state(network: string, address: string, feed: Feed): HistoryFeedStatus {
  const d = open()
  const s: any = d.prepare('SELECT newest, oldest, complete, synced_at FROM sync WHERE network=? AND address=? AND feed=?').get(network, address, feed)
  const c: any = d.prepare('SELECT COUNT(*) AS n FROM rows WHERE network=? AND address=? AND feed=?').get(network, address, feed)
  return {
    feed,
    count: Number(c?.n ?? 0),
    newest: s?.newest ?? undefined,
    oldest: s?.oldest ?? undefined,
    complete: !!s?.complete,
    syncedAt: s?.synced_at ?? undefined
  }
}

function saveState(network: string, address: string, s: HistoryFeedStatus): void {
  open()
    .prepare(
      `INSERT INTO sync (network, address, feed, newest, oldest, complete, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (network, address, feed) DO UPDATE SET
         newest = excluded.newest, oldest = excluded.oldest, complete = excluded.complete, synced_at = excluded.synced_at`
    )
    .run(network, address, s.feed, s.newest ?? null, s.oldest ?? null, s.complete ? 1 : 0, s.syncedAt ?? null)
}

/** Insert rows, ignoring ones already stored. Returns how many were new and the time span of the page. */
function insert(network: string, address: string, feed: Feed, rows: any[]): { added: number; min?: number; max?: number } {
  const d = open()
  const stmt = d.prepare('INSERT OR IGNORE INTO rows (network, address, feed, uid, time, raw) VALUES (?, ?, ?, ?, ?, ?)')
  let added = 0
  let min: number | undefined
  let max: number | undefined
  d.exec('BEGIN')
  try {
    for (const r of rows) {
      const t = rowTime(feed, r)
      added += Number(stmt.run(network, address, feed, rowUid(feed, r), t, JSON.stringify(r)).changes)
      min = min === undefined ? t : Math.min(min, t)
      max = max === undefined ? t : Math.max(max, t)
    }
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
  return { added, min, max }
}

// ---------- sync ----------

const running = new Map<string, { stop: boolean; done: Promise<HistoryFeedStatus[]> }>()
let lastSource: { host: string; fallback: boolean } | undefined

function progress(address: string, network: string, feed: Feed, added: number, phase: 'new' | 'older'): void {
  for (const w of BrowserWindow?.getAllWindows?.() ?? []) {
    w.webContents.send('history-progress', { address, network, feed, added, phase })
  }
}

async function syncFeed(network: string, address: string, feed: Feed, job: { stop: boolean }): Promise<void> {
  const s = state(network, address, feed)

  // 1) forward: everything newer than what we have (bounded by nature: it's only what happened since last sync)
  if (s.newest !== undefined) {
    let fp: string | undefined
    let added = 0
    do {
      const page = await fetchRaw(address, feed, { fingerprint: fp, min: s.newest - OVERLAP_MS })
      lastSource = { host: page.source, fallback: page.fallback }
      const r = insert(network, address, feed, page.rows)
      if (r.max !== undefined) s.newest = Math.max(s.newest, r.max)
      added += r.added
      if (r.added) progress(address, network, feed, added, 'new')
      fp = page.next
    } while (fp && !job.stop)
  }

  // 2) backfill: older rows, up to the budget; the rest continues next time
  if (!s.complete && !job.stop) {
    let fp: string | undefined
    let fetched = 0
    let added = 0
    const max = s.oldest // undefined on the very first sync = start from now
    do {
      const page = await fetchRaw(address, feed, { fingerprint: fp, max })
      lastSource = { host: page.source, fallback: page.fallback }
      const r = insert(network, address, feed, page.rows)
      fetched += page.rows.length
      added += r.added
      if (r.min !== undefined) s.oldest = s.oldest === undefined ? r.min : Math.min(s.oldest, r.min)
      if (r.max !== undefined) s.newest = s.newest === undefined ? r.max : Math.max(s.newest, r.max)
      if (r.added) progress(address, network, feed, added, 'older')
      fp = page.next
      if (!fp) s.complete = true // reached the account's first tx
    } while (fp && !job.stop && fetched < BUDGET[feed])
  }

  s.syncedAt = Date.now()
  saveState(network, address, s)
}

/** Fetch new rows and continue the backfill for every feed. Concurrent calls for the same account share one run. */
export function syncHistory(address: string): Promise<HistoryFeedStatus[]> {
  const network = getNetwork()
  const key = `${network}:${address}`
  const existing = running.get(key)
  if (existing) return existing.done
  const job = { stop: false, done: undefined as unknown as Promise<HistoryFeedStatus[]> }
  job.done = (async () => {
    try {
      for (const feed of FEEDS) {
        if (job.stop) break
        await syncFeed(network, address, feed, job)
      }
      return FEEDS.map((f) => state(network, address, f))
    } finally {
      running.delete(key)
    }
  })()
  running.set(key, job)
  return job.done
}

export function stopHistorySync(address: string): void {
  const job = running.get(`${getNetwork()}:${address}`)
  if (job) job.stop = true
}

// ---------- read ----------

/**
 * Cached history of an account, processed into items. `tokens` is the union of the TRC20 and USDT feeds
 * (deduplicated), so token rows are complete as far back as either feed reaches.
 */
export async function historyData(address: string): Promise<HistoryData> {
  const network = getNetwork()
  const d = open()
  const read = (feed: Feed) =>
    (d.prepare('SELECT uid, raw FROM rows WHERE network=? AND address=? AND feed=? ORDER BY time DESC').all(network, address, feed) as any[])
  const allRows = read('all').map((r) => JSON.parse(r.raw))
  const tokenRows = new Map<string, any>()
  for (const feed of ['trc20', 'usdt'] as Feed[]) for (const r of read(feed)) tokenRows.set(r.uid, JSON.parse(r.raw))
  const [all, tokens] = await Promise.all([
    processRows(address, 'all', allRows),
    processRows(address, 'trc20', [...tokenRows.values()])
  ])
  tokens.sort((a: HistoryItem, b: HistoryItem) => b.time - a.time)
  return {
    all,
    tokens,
    status: FEEDS.map((f) => state(network, address, f)),
    syncing: running.has(`${network}:${address}`),
    source: lastSource,
    path: cachePath()
  }
}

/** Forget an account's cached history on the current network (next sync starts from scratch). */
export function clearHistory(address: string): void {
  stopHistorySync(address)
  const network = getNetwork()
  const d = open()
  for (const t of ['rows', 'sync', 'balance_days', 'balance_sync']) {
    d.prepare(`DELETE FROM ${t} WHERE network=? AND address=?`).run(network, address)
  }
}

// ---------- daily balances ----------

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Daily TRX balance for the last `days` days. Past days come from the cache once fetched; only the last couple of
 * days are re-fetched (today is still changing). A range reaching further back than ever fetched is fetched once.
 */
export async function balanceHistoryCached(address: string, days: number): Promise<BalanceHistory> {
  const network = getNetwork()
  const d = open()
  const from = dayKey(Date.now() - (days - 1) * 86_400_000)
  const sync: any = d.prepare('SELECT from_day, source FROM balance_sync WHERE network=? AND address=?').get(network, address)
  const covered = sync && sync.from_day <= from
  const fresh = await fetchBalanceHistory(address, covered ? 3 : days).catch((e: Error) => {
    if (!covered) throw e
    return undefined // offline: serve the cache
  })
  if (fresh) {
    const up = d.prepare(
      'INSERT INTO balance_days (network, address, day, trx) VALUES (?, ?, ?, ?) ON CONFLICT (network, address, day) DO UPDATE SET trx = excluded.trx'
    )
    d.exec('BEGIN')
    for (const p of fresh.points) up.run(network, address, p.day, p.trx)
    if (!covered) {
      d.prepare(
        `INSERT INTO balance_sync (network, address, from_day, source) VALUES (?, ?, ?, ?)
         ON CONFLICT (network, address) DO UPDATE SET from_day = MIN(from_day, excluded.from_day), source = excluded.source`
      ).run(network, address, from, fresh.source)
    }
    d.exec('COMMIT')
  }
  const points = (d
    .prepare('SELECT day, trx FROM balance_days WHERE network=? AND address=? AND day >= ? ORDER BY day')
    .all(network, address, from) as any[]).map((r) => ({ day: String(r.day), trx: Number(r.trx) }))
  return { points, source: fresh?.source ?? sync?.source ?? 'cache' }
}
