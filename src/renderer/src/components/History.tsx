import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  Balances,
  BalancePoint,
  HistoryItem,
  HistoryKind,
  HistoryQueryResult,
  NetworkId,
  PublicKey
} from '../../../shared/types'
import { fmt, short } from '../ui'
import { Bars, LineChart } from './history/charts'
import { FEE_PARTS, typeLabel, typeOrder, type FeeSplit } from '../../../shared/txtypes'
import { EMPTY_FILTERS, RANGES, dayKey, totals, type Filters, type RangeId, type Totals } from '../../../shared/historyData'

const ARROW: Record<HistoryItem['direction'], string> = { in: '←', out: '→', self: '↺', other: '·' }
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const PAGE_SIZE = 100
const EMPTY_TOTALS = totals([])

/**
 * History from the local SQLite cache. The main process keeps the processed history and answers queries
 * (range + filters + one page + totals / chart data), so the renderer only ever holds one page.
 * After showing the cache it syncs in the background (new txs + older ones) and re-queries as rows arrive.
 */
function useHistory(address: string, network: NetworkId, query: { days: number; filters: Filters; page: number; usdtBalance: number | null }) {
  const [res, setRes] = useState<HistoryQueryResult>()
  const [syncing, setSyncing] = useState(false)
  const [added, setAdded] = useState({ new: 0, older: 0 })
  const [error, setError] = useState<string>()
  const current = useRef(`${network}:${address}`)
  current.current = `${network}:${address}`
  const queryRef = useRef(query)
  queryRef.current = query

  const load = async () => {
    const key = `${network}:${address}`
    const q = queryRef.current
    try {
      const r = await window.api.historyQuery(address, { ...q, pageSize: PAGE_SIZE })
      if (current.current === key) setRes(r)
    } catch (e: any) {
      if (current.current === key) setError(e.message)
    }
  }

  const sync = async () => {
    const key = `${network}:${address}`
    setSyncing(true)
    setError(undefined)
    setAdded({ new: 0, older: 0 })
    try {
      await window.api.historySync(address)
    } catch (e: any) {
      if (current.current === key) setError(e.message)
    } finally {
      if (current.current === key) {
        setSyncing(false)
        await load()
      }
    }
  }

  // new account / network: show the cache, then sync
  useEffect(() => {
    setRes(undefined)
    load().then(sync)
  }, [address, network])

  // range / filters / page changed: re-query (search is debounced by the caller)
  const qKey = JSON.stringify(query)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    load()
  }, [qKey])

  // progress events: count rows and re-query at most every ~2 s while syncing
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onHistoryProgress((p) => {
      if (p.address !== address || p.network !== network) return
      setAdded((a) => ({ ...a, [p.phase]: Math.max(a[p.phase], p.added) }))
      timer ??= setTimeout(() => {
        timer = undefined
        load()
      }, 2000)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [address, network])

  // live mode saw a tx of this address: it is stored once confirmed (~1 min), so sync a bit after that.
  // Several txs in a row share one sync.
  const syncRef = useRef(sync)
  syncRef.current = sync
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.api.onLiveActivity((hits) => {
      if (!hits.some((x) => x.address === address && x.network === network)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => syncRef.current(), 75_000)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [address, network])

  return {
    res,
    syncing,
    added,
    error,
    sync,
    stop: () => window.api.historyStop(address),
    clear: async () => {
      await window.api.historyClear(address)
      setRes(undefined)
      await load()
      await sync()
    }
  }
}

export function History({ from, keys, network, balances }: {
  from: PublicKey
  keys: PublicKey[]
  network: NetworkId
  balances?: Balances
}) {
  const [range, setRange] = useState<RangeId>('90d')
  const [series, setSeries] = useState<'trx' | 'usdt'>('trx')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [explorer, setExplorer] = useState('')
  const [trxDaily, setTrxDaily] = useState<{ points: BalancePoint[]; source: string; error?: string }>()
  const days = RANGES.find((r) => r.id === range)!.days

  // typing in search waits a moment before querying
  useEffect(() => {
    const t = setTimeout(() => setFilters((f) => (f.search === search ? f : { ...f, search })), 250)
    return () => clearTimeout(t)
  }, [search])
  // a new range / filter starts at the first page
  useEffect(() => setPage(0), [filters, range, from.address])

  const h = useHistory(from.address, network, { days, filters, page, usdtBalance: balances?.usdt ?? null })
  const res = h.res
  const allStatus = res?.status.find((x) => x.feed === 'all')
  const t: Totals = res?.totals ?? EMPTY_TOTALS
  const buckets = res?.buckets ?? []
  const weekly = res?.weekly ?? days > 120
  const counts = useMemo(() => new Map(res?.counts ?? []), [res])
  const rangeTotal = res?.rangeTotal ?? 0
  const total = res?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  useEffect(() => {
    window.api.explorerUrl('').then(setExplorer)
  }, [network])

  // daily TRX balance from Tronscan for the selected range
  useEffect(() => {
    let alive = true
    setTrxDaily(undefined)
    window.api
      .balanceHistory(from.address, days)
      .then((b) => alive && setTrxDaily(b))
      .catch((e) => alive && setTrxDaily({ points: [], source: '', error: e.message }))
    return () => {
      alive = false
    }
  }, [from.address, network, days])

  const labels = useMemo(
    () => new Map(keys.map((k) => [k.address, `#${k.id}${k.label ? ` ${k.label}` : ''}`])),
    [keys]
  )

  // balance series: TRX from Tronscan (cached per day); USDT rebuilt in the main process from cached USDT transfers
  const usdtPoints = res?.usdt.points ?? []
  const usdtCount = res?.usdt.count ?? 0
  const usdtCut = !!res?.usdt.cutFrom
  const points = series === 'trx' ? (trxDaily?.points.map((p) => ({ day: p.day, value: p.trx })) ?? []) : usdtPoints
  const first = points[0]?.value ?? 0
  const last = points[points.length - 1]?.value ?? 0
  const change = last - first

  const toggleKind = (k: HistoryKind) =>
    setFilters((f) => ({ ...f, kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k] }))

  return (
    <div className="form history">
      {/* status + range */}
      <div className="row" style={{ alignItems: 'center' }}>
        <nav className="seg">
          {RANGES.map((r) => (
            <button key={r.id} className={r.id === range ? 'on' : ''} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        <span className="muted small">
          {fmt(res?.cachedTotal ?? 0, 0)} txs cached
          {allStatus?.complete
            ? ' · complete'
            : allStatus?.oldest !== undefined && ` · back to ${dayKey(allStatus.oldest)}`}
          {h.syncing
            ? ` · syncing${h.added.new ? ` +${fmt(h.added.new, 0)} new` : ''}${h.added.older ? ` +${fmt(h.added.older, 0)} older` : ''}…`
            : allStatus?.syncedAt && ` · synced ${new Date(allStatus.syncedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
          {res?.source && ` · ${res.source.host}`}
          {res?.source?.fallback && ' (active node has no history API)'}
        </span>
        {h.syncing ? (
          <button className="ghost" onClick={h.stop}>
            stop
          </button>
        ) : (
          <>
            {res && !res.status.every((x) => x.complete) && (
              <button className="ghost" onClick={h.sync} title="Continue loading older transactions">
                load older
              </button>
            )}
            <button className="ghost" onClick={h.sync} title="Fetch new transactions">
              sync
            </button>
            <button
              className="ghost"
              onClick={h.clear}
              title={`Delete this address's cached history (${res?.path ?? 'cache.sqlite'}) and download it again`}
            >
              clear cache
            </button>
          </>
        )}
      </div>
      {h.error && <div className="error small">sync stopped: {h.error} (cached data is still shown)</div>}

      {/* balance chart */}
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">balance</span>
          <nav className="seg small-seg">
            {(['trx', 'usdt'] as const).map((s) => (
              <button key={s} className={s === series ? 'on' : ''} onClick={() => setSeries(s)}>
                {s}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          {points.length > 1 && (
            <span>
              <span className="muted">
                {fmt(first, 2)} → {fmt(last, 2)} {series}
              </span>{' '}
              <b className={change > 0 ? 'ok' : change < 0 ? 'error' : ''}>
                {change >= 0 ? '+' : '−'}
                {fmt(Math.abs(change), 4)} {series}
                {first > 0 && ` (${change >= 0 ? '+' : '−'}${fmt(Math.abs((change / first) * 100), 1)}%)`}
              </b>
            </span>
          )}
        </div>
        {series === 'trx' && !trxDaily && <div className="chart-empty muted">loading daily balance from Tronscan…</div>}
        {series === 'trx' && trxDaily?.error && <div className="chart-empty error">{trxDaily.error}</div>}
        {series === 'usdt' && !res && <div className="chart-empty muted">reading cache…</div>}
        {series === 'usdt' && res && balances?.usdt == null && (
          <div className="chart-empty muted">no USDT balance for this network</div>
        )}
        {points.length > 0 && <LineChart points={points} unit={series} label={`${series} balance per day`} />}
        <div className="muted small">
          {series === 'trx'
            ? `daily balance (end of day, UTC) from ${trxDaily?.source || 'Tronscan'}`
            : usdtCut
              ? `usdt balance shown from ${res!.usdt.cutFrom}: older usdt transfers are not cached yet${h.syncing ? ' (syncing…)' : ' — use "load older"'}`
              : `rebuilt from ${fmt(usdtCount, 0)} cached usdt transfers back from today's balance`}
        </div>
      </section>

      {/* totals */}
      <FeesPanel t={t} />
      <section className="totals">
        <div className="panel">
          <div className="panel-title">resources used</div>
          <div className="big">{fmt(t.energy, 0)} energy</div>
          <dl className="kv single compact">
            <Kv k="bandwidth" v={`${fmt(t.bandwidth, 0)} B`} />
            <Kv k="failed txs" v={fmt(t.failed, 0)} />
          </dl>
        </div>
        <div className="panel">
          <div className="panel-title">flows</div>
          <dl className="kv single compact">
            <Kv k="trx in" v={`+${fmt(t.trxIn, 4)}`} />
            <Kv k="trx out" v={`−${fmt(t.trxOut, 4)}`} />
            <Kv k="trx net" v={signed(t.trxIn - t.trxOut)} />
            <Kv k="usdt in" v={`+${fmt(t.usdtIn, 4)}`} />
            <Kv k="usdt out" v={`−${fmt(t.usdtOut, 4)}`} />
            <Kv k="usdt net" v={signed(t.usdtIn - t.usdtOut)} />
          </dl>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">fees burned per {weekly ? 'week' : 'day'}</span>
          <span className="spacer" />
          <span className="muted small">txs sent by this address{filters.kinds.length ? ', filtered' : ''}</span>
        </div>
        <Bars
          buckets={buckets.map((b) => ({ key: b.key, start: b.start, value: b.fee }))}
          label="fees burned per period"
          tip={(i) => {
            const b = buckets[i]
            return (
              <>
                <div className="muted">
                  {weekly ? 'week of ' : ''}
                  {b.start}
                </div>
                <b>{fmt(b.fee, 4)} trx</b>
                {feeLines(b.fees).map(([label, v]) => (
                  <div key={label} className="muted">
                    {label} {fmt(v, 4)}
                  </div>
                ))}
                <div className="muted">{b.txs} txs</div>
              </>
            )
          }}
        />
      </section>

      {/* filters */}
      <div className="filters">
        <div className="chips">
          <button
            className={`chip ${filters.kinds.length === 0 ? 'on' : ''}`}
            onClick={() => setFilters((f) => ({ ...f, kinds: [] }))}
          >
            all <span className="count">{rangeTotal}</span>
          </button>
          {[...counts.keys()]
            .sort((a, b) => typeOrder(a) - typeOrder(b) || a.localeCompare(b))
            .map((k) => (
            <button key={k} className={`chip ${filters.kinds.includes(k) ? 'on' : ''}`} onClick={() => toggleKind(k)}>
              {typeLabel(k)} <span className="count">{counts.get(k)}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <nav className="seg">
            {(['all', 'in', 'out'] as const).map((d) => (
              <button key={d} className={filters.direction === d ? 'on' : ''} onClick={() => setFilters((f) => ({ ...f, direction: d }))}>
                {d}
              </button>
            ))}
          </nav>
          <nav className="seg">
            {(['all', 'success', 'failed'] as const).map((r) => (
              <button key={r} className={filters.result === r ? 'on' : ''} onClick={() => setFilters((f) => ({ ...f, result: r }))}>
                {r}
              </button>
            ))}
          </nav>
          <input
            className="search"
            placeholder="search txid, address, note, #id…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {(filters.kinds.length > 0 || filters.direction !== 'all' || filters.result !== 'all' || search) && (
            <button
              className="link"
              onClick={() => {
                setSearch('')
                setFilters(EMPTY_FILTERS)
              }}
            >
              clear filters
            </button>
          )}
          <span className="spacer" />
          <span className="muted small">
            {fmt(total, 0)} of {fmt(rangeTotal, 0)} txs
          </span>
        </div>
      </div>

      {/* table */}
      {res && !h.syncing && total === 0 && <div className="muted">No transactions match.</div>}
      {res && res.rows.length > 0 && (
        <div className="table-scroll">
          <table className="nodes hist">
            <thead>
              <tr>
                <th>time</th>
                <th>type</th>
                <th />
                <th>counterparty</th>
                <th>amount</th>
                <th>fee · energy · bw</th>
                <th>result</th>
                <th>tx</th>
              </tr>
            </thead>
            <tbody>
              {res.rows.map((x) => (
                <tr key={x.txid + x.type}>
                  <td className="nowrap muted">{when(x.time)}</td>
                  <td>
                    <span title={x.type}>{x.kind === 'trc20' ? x.type : typeLabel(x.kind)}</span>
                    {x.unit && x.kind === 'token' && !x.isUsdt && x.tokenContract && (
                      <span className="warn small" title={x.tokenContract}>
                        {' '}
                        (not the official usdt)
                      </span>
                    )}
                    {x.note && (
                      <div className="muted small note" title={x.note}>
                        “{x.note}”
                      </div>
                    )}
                  </td>
                  <td className={`dir ${x.direction}`}>{ARROW[x.direction]}</td>
                  <td className="nowrap" title={x.counterparty}>
                    {x.counterparty ? short(x.counterparty) : ''}{' '}
                    <span className="muted">{x.counterparty ? labels.get(x.counterparty) : ''}</span>
                  </td>
                  <td className={`nowrap ${x.sign > 0 ? 'ok' : ''}`}>
                    {x.value !== undefined ? `${x.sign > 0 ? '+' : x.sign < 0 ? '−' : ''}${fmt(x.value, 6)} ${x.unit}` : (x.amount ?? '')}
                    {x.kind === 'delegate' || x.kind === 'undelegate' ? <span className="muted"> {x.amount?.split(' ').pop()}</span> : null}
                  </td>
                  <td
                    className="nowrap muted"
                    title={
                      x.paidByMe
                        ? feeLines(x.fees).map(([l, v]) => `${l} ${fmt(v, 6)} trx`).join(' · ') || 'no TRX burned'
                        : 'paid by the sender'
                    }
                  >
                    {x.paidByMe ? (x.feeTrx ? `${fmt(x.feeTrx, 4)} trx` : '0') : '—'} · {fmt(x.energy, 0)} · {fmt(x.bandwidth, 0)}
                  </td>
                  <td className={x.result === 'SUCCESS' ? 'ok' : 'error'}>{x.result.toLowerCase()}</td>
                  <td>
                    <a href={explorer + x.txid} target="_blank" rel="noreferrer" className="mono">
                      {x.txid.slice(0, 8)}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE_SIZE && (
        <div className="pager">
          <button className="ghost" disabled={page === 0} onClick={() => setPage(0)}>
            first
          </button>
          <button className="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← prev
          </button>
          <span className="muted">
            {fmt(page * PAGE_SIZE + 1, 0)}–{fmt(Math.min(total, (page + 1) * PAGE_SIZE), 0)} of {fmt(total, 0)} · page{' '}
            {page + 1}/{pages}
          </span>
          <button className="ghost" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            next →
          </button>
          <button className="ghost" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>
            last
          </button>
        </div>
      )}
    </div>
  )
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), 4)}`

function Kv({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="kv-row" title={hint}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  )
}

/** Non-zero fee parts as [label, trx]. */
function feeLines(f: FeeSplit): [string, number][] {
  return FEE_PARTS.filter((p) => f[p.key] > 0).map((p) => [p.label, f[p.key]])
}

/** Fees burned by cause: resource shortage (bandwidth, energy) vs fixed fees (account creation, memo, …). */
function FeesPanel({ t }: { t: Totals }) {
  const row = (key: keyof FeeSplit, indent = false) => {
    const part = FEE_PARTS.find((p) => p.key === key)!
    const v = t.fees[key]
    const share = t.fee > 0 ? v / t.fee : 0
    return (
      <div key={key} className={`fee-row ${v > 0 ? '' : 'zero'} ${indent ? 'indent' : ''}`} title={part.hint}>
        <span className="fee-label">{part.label}</span>
        <span className="fee-value">{fmt(v, 4)} trx</span>
        <span className="fee-count muted">
          {t.feeTxs[key] ? `${fmt(t.feeTxs[key], 0)} tx${t.feeTxs[key] === 1 ? '' : 's'}` : ''}
          {key === 'activation' && t.accountsCreated > 0 && ` · ${fmt(t.accountsCreated, 0)} accounts created`}
        </span>
        <span className="fee-share">
          <span className="share-bar">
            <span style={{ width: `${Math.max(v > 0 ? 2 : 0, share * 100)}%` }} />
          </span>
          <span className="muted">{v > 0 ? `${fmt(share * 100, 1)}%` : ''}</span>
        </span>
      </div>
    )
  }
  const fixed: (keyof FeeSplit)[] = ['activation', 'memo', 'multisig', 'permission', 'other']
  const shortage = t.fees.bandwidth + t.fees.energy
  return (
    <div className="panel fees-panel">
      <div className="panel-head">
        <span className="panel-title">fees burned</span>
        <span className="big">{fmt(t.fee, 4)} trx</span>
        <span className="spacer" />
        <span className="muted small">
          {fmt(t.paid, 0)} of {fmt(t.txs, 0)} txs sent by this address
        </span>
      </div>
      <div className="fee-group">
        <span className="fee-group-title">resource shortage</span>
        <span className="muted small">{fmt(shortage, 4)} trx · not enough staked / free resources</span>
      </div>
      {row('bandwidth', true)}
      {row('energy', true)}
      <div className="fee-group">
        <span className="fee-group-title">fixed fees</span>
        <span className="muted small">{fmt(t.fee - shortage, 4)} trx</span>
      </div>
      {fixed.filter((k) => k !== 'other' || t.fees.other > 0).map((k) => row(k, true))}
    </div>
  )
}
