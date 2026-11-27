import { useEffect, useMemo, useRef, useState } from 'react'
import type { Balances, BalancePoint, HistoryItem, HistoryKind, NetworkId, PublicKey } from '../../../shared/types'
import { fmt, short } from '../ui'
import { Bars, LineChart } from './history/charts'
import {
  EMPTY_FILTERS,
  KIND_ORDER,
  RANGES,
  applyFilters,
  dayList,
  feeBuckets,
  inRange,
  kindCounts,
  mergeFeeds,
  totals,
  usdtSeries,
  type Filters,
  type RangeId
} from './history/data'

const ARROW: Record<HistoryItem['direction'], string> = { in: '←', out: '→', self: '↺', other: '·' }
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
// shorter labels for the long contract type names
const TYPE: Record<string, string> = {
  TriggerSmart: 'contract call',
  CreateSmart: 'deploy contract',
  FreezeBalanceV2: 'stake',
  UnfreezeBalanceV2: 'unstake',
  WithdrawExpireUnfreeze: 'withdraw unstaked',
  CancelAllUnfreezeV2: 'cancel unstakes',
  DelegateResource: 'delegate',
  UnDelegateResource: 'reclaim',
  VoteWitness: 'vote',
  WithdrawBalance: 'claim rewards',
  AccountPermissionUpdate: 'permission update',
  Transfer: 'transfer',
  TransferAsset: 'trc10 transfer'
}

/** Stop loading after this many items per feed (keeps huge accounts usable). */
const CAP = 5000
const ROWS_STEP = 200

interface Loaded {
  items: HistoryItem[]
  capped: boolean
  source?: { host: string; fallback: boolean }
  done: boolean
  error?: string
}

// survives tab switches; cleared by "reload"
const cache = new Map<string, Loaded>()

/** Loads both TronGrid feeds page by page (200/page) up to CAP, reporting progress; cached per network + address. */
function useHistory(address: string, network: NetworkId) {
  const key = `${network}:${address}`
  const [state, setState] = useState<Loaded>(() => cache.get(key) ?? { items: [], capped: false, done: false })
  const [progress, setProgress] = useState(0)
  const stop = useRef(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    const cached = cache.get(key)
    if (cached?.done) {
      setState(cached)
      return
    }
    stop.current = false
    let alive = true
    setState({ items: [], capped: false, done: false })
    setProgress(0)
    ;(async () => {
      const feeds: Record<'all' | 'trc20', HistoryItem[]> = { all: [], trc20: [] }
      let capped = false
      let source: Loaded['source']
      try {
        for (const kind of ['all', 'trc20'] as const) {
          let next: string | undefined
          do {
            const page = await window.api.history(address, kind, next)
            if (!alive) return
            source ??= { host: page.source, fallback: page.fallback }
            feeds[kind].push(...page.items)
            next = page.items.length ? page.next : undefined
            setProgress(feeds.all.length + feeds.trc20.length)
            if (feeds[kind].length >= CAP && next) capped = true
          } while (next && !stop.current && feeds[kind].length < CAP)
        }
        const done: Loaded = { items: mergeFeeds(feeds.all, feeds.trc20), capped: capped || stop.current, source, done: true }
        cache.set(key, done)
        if (alive) setState(done)
      } catch (e: any) {
        if (!alive) return
        // keep whatever loaded so far, so a rate limit late in the list still shows the rest
        setState({ items: mergeFeeds(feeds.all, feeds.trc20), capped: true, source, done: true, error: e.message })
      }
    })()
    return () => {
      alive = false
    }
  }, [key, nonce])

  return {
    ...state,
    progress,
    stop: () => (stop.current = true),
    reload: () => {
      cache.delete(key)
      setNonce((n) => n + 1)
    }
  }
}

export function History({ from, keys, network, balances }: {
  from: PublicKey
  keys: PublicKey[]
  network: NetworkId
  balances?: Balances
}) {
  const h = useHistory(from.address, network)
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
  const ranged = useMemo(() => inRange(h.items, days), [h.items, days])
  const counts = useMemo(() => kindCounts(ranged), [ranged])
  const filtered = useMemo(() => applyFilters(ranged, filters, labels), [ranged, filters, labels])
  const t = useMemo(() => totals(filtered), [filtered])
  const dayKeys = useMemo(() => dayList(days), [days])
  const buckets = useMemo(() => feeBuckets(filtered, dayKeys), [filtered, dayKeys])

  // balance series: TRX from Tronscan, USDT rebuilt from transfers (only meaningful once everything is loaded)
  const usdtPoints = useMemo(
    () => (h.done && balances?.usdt != null ? usdtSeries(h.items, balances.usdt, dayKeys) : []),
    [h.done, h.items, balances?.usdt, dayKeys]
  )
  const oldestLoaded = h.items.length ? h.items[h.items.length - 1].time : 0
  const usdtApprox = h.capped && oldestLoaded > Date.now() - days * 86_400_000
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
        {!h.done ? (
          <span className="muted small">
            loading history… {fmt(h.progress, 0)} txs{' '}
            <button className="link" onClick={h.stop}>
              stop
            </button>
          </span>
        ) : (
          <span className="muted small">
            {fmt(h.items.length, 0)} txs loaded{h.capped && ' (not complete)'}
            {h.source && ` · ${h.source.host}`}
            {h.source?.fallback && ' (active node has no history API)'}
          </span>
        )}
        <button className="ghost" onClick={h.reload} disabled={!h.done}>
          reload
        </button>
      </div>
      {h.error && <div className="error small">stopped early: {h.error}</div>}

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
        {series === 'usdt' && !h.done && <div className="chart-empty muted">waiting for the full transfer list…</div>}
        {series === 'usdt' && h.done && balances?.usdt == null && (
          <div className="chart-empty muted">no USDT balance for this network</div>
        )}
        {points.length > 0 && <LineChart points={points} unit={series} label={`${series} balance per day`} />}
        <div className="muted small">
          {series === 'trx'
            ? `daily balance (end of day, UTC) from ${trxDaily?.source || 'Tronscan'}`
            : `rebuilt from USDT transfers back from today's balance${usdtApprox ? ` · approximate before ${new Date(oldestLoaded).toISOString().slice(0, 10)} (history not complete)` : ''}`}
        </div>
      </section>

      {/* totals */}
      <section className="totals">
        <div className="panel">
          <div className="panel-title">fees burned</div>
          <div className="big">{fmt(t.fee, 4)} trx</div>
          <dl className="kv single compact">
            <Kv k="bandwidth" v={`${fmt(t.netFee, 4)} trx`} />
            <Kv k="energy" v={`${fmt(t.energyFee, 4)} trx`} />
            <Kv k="other" v={`${fmt(t.otherFee, 4)} trx`} hint="memo, multi-signature, activation, permission update" />
            <Kv k="paid txs" v={`${fmt(t.paid, 0)} of ${fmt(t.txs, 0)}`} />
          </dl>
        </div>
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
                <div className="muted">
                  bw {fmt(b.netFee, 4)} · energy {fmt(b.energyFee, 4)} · other {fmt(b.otherFee, 4)}
                </div>
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
          {KIND_ORDER.filter((k) => counts.get(k)).map((k) => (
            <button key={k} className={`chip ${filters.kinds.has(k) ? 'on' : ''}`} onClick={() => toggleKind(k)}>
              {k} <span className="count">{counts.get(k)}</span>
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
      {h.done && filtered.length === 0 && <div className="muted">No transactions match.</div>}
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
                    <span title={x.type}>{TYPE[x.type] ?? x.type}</span>
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
                    {x.kind === 'delegate' || x.kind === 'reclaim' ? <span className="muted"> {x.amount?.split(' ').pop()}</span> : null}
                  </td>
                  <td
                    className="nowrap muted"
                    title={
                      x.paidByMe
                        ? `bandwidth ${fmt(x.netFeeTrx, 6)} · energy ${fmt(x.energyFeeTrx, 6)} · other ${fmt(x.otherFeeTrx, 6)} trx`
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
