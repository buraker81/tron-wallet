import { useEffect, useMemo, useRef, useState } from 'react'
import type { Balances, BalancePoint, HistoryData, HistoryItem, HistoryKind, NetworkId, PublicKey } from '../../../shared/types'
import { fmt, short } from '../ui'
import { Bars, LineChart } from './history/charts'
import { FEE_PARTS, typeLabel, typeOrder, type FeeSplit } from '../../../shared/txtypes'
import {
  EMPTY_FILTERS,
  RANGES,
  applyFilters,
  dayList,
  feeBuckets,
  inRange,
  kindCounts,
  mergeFeeds,
  totals,
  usdtSeries,
  dayKey,
  type Filters,
  type RangeId
} from './history/data'

const ARROW: Record<HistoryItem['direction'], string> = { in: '←', out: '→', self: '↺', other: '·' }
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

const ROWS_STEP = 200

/**
 * History from the local SQLite cache: shows what is cached immediately, then syncs in the background
 * (new txs + continue loading older ones) and refreshes as rows arrive.
 */
function useHistoryCache(address: string, network: NetworkId) {
  const [data, setData] = useState<HistoryData>()
  const [syncing, setSyncing] = useState(false)
  const [added, setAdded] = useState({ new: 0, older: 0 })
  const [error, setError] = useState<string>()
  const current = useRef(`${network}:${address}`)
  current.current = `${network}:${address}`

  const load = async () => {
    const key = `${network}:${address}`
    const d = await window.api.historyData(address)
    if (current.current === key) setData(d)
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

  useEffect(() => {
    setData(undefined)
    load().then(sync)
  }, [address, network])

  // progress events: count rows and re-read the cache every ~2 s so new rows show up while syncing
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
    data,
    syncing,
    added,
    error,
    sync,
    stop: () => window.api.historyStop(address),
    clear: async () => {
      await window.api.historyClear(address)
      setData(undefined)
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
  const h = useHistoryCache(from.address, network)
  const items = useMemo(() => (h.data ? mergeFeeds(h.data.all, h.data.tokens) : []), [h.data])
  const allStatus = h.data?.status.find((x) => x.feed === 'all')
  const usdtStatus = h.data?.status.find((x) => x.feed === 'usdt')
  const [range, setRange] = useState<RangeId>('90d')
  const [series, setSeries] = useState<'trx' | 'usdt'>('trx')
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [rows, setRows] = useState(ROWS_STEP)
  const [explorer, setExplorer] = useState('')
  const [trxDaily, setTrxDaily] = useState<{ points: BalancePoint[]; source: string; error?: string }>()
  const days = RANGES.find((r) => r.id === range)!.days

  useEffect(() => {
    window.api.explorerUrl('').then(setExplorer)
  }, [network])
  useEffect(() => setRows(ROWS_STEP), [filters, range, from.address])

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
  const ranged = useMemo(() => inRange(items, days), [items, days])
  const counts = useMemo(() => kindCounts(ranged), [ranged])
  const filtered = useMemo(() => applyFilters(ranged, filters, labels), [ranged, filters, labels])
  const t = useMemo(() => totals(filtered), [filtered])
  const dayKeys = useMemo(() => dayList(days), [days])
  const buckets = useMemo(() => feeBuckets(filtered, dayKeys), [filtered, dayKeys])

  // balance series: TRX from Tronscan (cached per day); USDT rebuilt from the cached official USDT transfers
  const usdtCount = useMemo(() => (h.data ? h.data.tokens.filter((x) => x.isUsdt).length : 0), [h.data])
  const usdtPoints = useMemo(() => {
    if (!h.data || !usdtStatus || balances?.usdt == null) return []
    const all = usdtSeries(h.data.tokens, balances.usdt, dayKeys)
    // until the USDT feed is fully cached, only days after its oldest cached transfer are exact
    return usdtStatus.complete || usdtStatus.oldest === undefined ? all : all.filter((p) => p.day >= dayKey(usdtStatus.oldest!))
  }, [h.data, usdtStatus, balances?.usdt, dayKeys])
  const usdtCut = !!usdtStatus && !usdtStatus.complete && usdtStatus.oldest !== undefined && usdtPoints.length < dayKeys.length
  const points = series === 'trx' ? (trxDaily?.points.map((p) => ({ day: p.day, value: p.trx })) ?? []) : usdtPoints
  const first = points[0]?.value ?? 0
  const last = points[points.length - 1]?.value ?? 0
  const change = last - first

  const toggleKind = (k: HistoryKind) =>
    setFilters((f) => {
      const kinds = new Set(f.kinds)
      kinds.has(k) ? kinds.delete(k) : kinds.add(k)
      return { ...f, kinds }
    })

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
          {fmt(items.length, 0)} txs cached
          {allStatus?.complete
            ? ' · complete'
            : allStatus?.oldest !== undefined && ` · back to ${dayKey(allStatus.oldest)}`}
          {h.syncing
            ? ` · syncing${h.added.new ? ` +${fmt(h.added.new, 0)} new` : ''}${h.added.older ? ` +${fmt(h.added.older, 0)} older` : ''}…`
            : allStatus?.syncedAt && ` · synced ${new Date(allStatus.syncedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
          {h.data?.source && ` · ${h.data.source.host}`}
          {h.data?.source?.fallback && ' (active node has no history API)'}
        </span>
        {h.syncing ? (
          <button className="ghost" onClick={h.stop}>
            stop
          </button>
        ) : (
          <>
            {h.data && !h.data.status.every((x) => x.complete) && (
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
              title={`Delete this address's cached history (${h.data?.path ?? 'cache.sqlite'}) and download it again`}
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
        {series === 'usdt' && !h.data && <div className="chart-empty muted">reading cache…</div>}
        {series === 'usdt' && h.data && balances?.usdt == null && (
          <div className="chart-empty muted">no USDT balance for this network</div>
        )}
        {points.length > 0 && <LineChart points={points} unit={series} label={`${series} balance per day`} />}
        <div className="muted small">
          {series === 'trx'
            ? `daily balance (end of day, UTC) from ${trxDaily?.source || 'Tronscan'}`
            : usdtCut
              ? `usdt balance shown from ${dayKey(usdtStatus!.oldest!)}: older usdt transfers are not cached yet${h.syncing ? ' (syncing…)' : ' — use "load older"'}`
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
          <span className="panel-title">fees burned per {dayKeys.length > 120 ? 'week' : 'day'}</span>
          <span className="spacer" />
          <span className="muted small">txs sent by this address{filters.kinds.size ? ', filtered' : ''}</span>
        </div>
        <Bars
          buckets={buckets.map((b) => ({ key: b.key, start: b.start, value: b.fee }))}
          label="fees burned per period"
          tip={(i) => {
            const b = buckets[i]
            return (
              <>
                <div className="muted">
                  {dayKeys.length > 120 ? 'week of ' : ''}
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
            className={`chip ${filters.kinds.size === 0 ? 'on' : ''}`}
            onClick={() => setFilters((f) => ({ ...f, kinds: new Set() }))}
          >
            all <span className="count">{ranged.length}</span>
          </button>
          {[...counts.keys()]
            .sort((a, b) => typeOrder(a) - typeOrder(b) || a.localeCompare(b))
            .map((k) => (
            <button key={k} className={`chip ${filters.kinds.has(k) ? 'on' : ''}`} onClick={() => toggleKind(k)}>
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
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
          {(filters.kinds.size > 0 || filters.direction !== 'all' || filters.result !== 'all' || filters.search) && (
            <button className="link" onClick={() => setFilters(EMPTY_FILTERS)}>
              clear filters
            </button>
          )}
          <span className="spacer" />
          <span className="muted small">
            {fmt(filtered.length, 0)} of {fmt(ranged.length, 0)} txs
          </span>
        </div>
      </div>

      {/* table */}
      {h.data && !h.syncing && filtered.length === 0 && <div className="muted">No transactions match.</div>}
      {filtered.length > 0 && (
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
              {filtered.slice(0, rows).map((x) => (
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
      {filtered.length > rows && (
        <div className="row">
          <button onClick={() => setRows((r) => r + ROWS_STEP)}>
            show more ({fmt(filtered.length - rows, 0)} left)
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
function FeesPanel({ t }: { t: ReturnType<typeof totals> }) {
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
