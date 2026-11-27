import { useCallback, useEffect, useState } from 'react'
import type { Balances, Delegation, DelegationInfo, NetworkId, PublicKey, Resource } from '../../../shared/types'
import type { RunTx } from '../App'
import { AddressInput, Field, TxOptionsInput, EMPTY_TX_OPTS, fmt, short, toOpts } from '../ui'
import { FeeEstimate } from './FeeEstimate'

const BLOCK_SECONDS = 3
const blocksToText = (blocks: number) => {
  const s = blocks * BLOCK_SECONDS
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${(s / 3600).toFixed(1).replace(/\.0$/, '')} h`
  return `${(s / 86400).toFixed(1).replace(/\.0$/, '')} days`
}

interface Props {
  from: PublicKey
  keys: PublicKey[]
  balances?: Balances
  network: NetworkId
  runTx: RunTx
  busy: boolean
}

export function Delegate({ from, keys, balances, network, runTx, busy }: Props) {
  const [info, setInfo] = useState<DelegationInfo>()
  const [error, setError] = useState<string>()
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [resource, setResource] = useState<Resource>('ENERGY')
  const [lock, setLock] = useState(false)
  const [lockDays, setLockDays] = useState('3')
  const [permId, setPermId] = useState(EMPTY_TX_OPTS)

  const load = useCallback(() => {
    setError(undefined)
    window.api.delegationInfo(from.address).then(setInfo).catch((e) => setError(e.message))
  }, [from.address])

  // reload on address / network change and whenever balances refresh (after a tx)
  useEffect(() => {
    setInfo(undefined)
    load()
  }, [load, network])
  useEffect(() => {
    if (balances) load()
  }, [balances])

  const max = info ? (resource === 'ENERGY' ? info.maxDelegatable.energy : info.maxDelegatable.bandwidth) : 0
  const n = Number(amount)
  const lockBlocks = lock ? Math.round((Number(lockDays) * 86400) / BLOCK_SECONDS) : 0
  const lockTooLong = !!info && lockBlocks > info.maxLockPeriodBlocks
  const validTo = to.startsWith('T') && to.length === 34 && to !== from.address
  const canDelegate = validTo && n >= 1 && n <= max && (!lock || (lockBlocks > 0 && !lockTooLong))

  return (
    <div className="form">
      <div className="muted">
        Lend the energy or bandwidth from your staked TRX to another address. The TRX stays yours and can be reclaimed
        (after the lock ends, if you set one).
      </div>
      {error && <div className="error">{error}</div>}

      <dl className="kv single">
        <div className="kv-row">
          <dt>can delegate</dt>
          <dd>
            {info
              ? `${fmt(info.maxDelegatable.energy)} trx energy · ${fmt(info.maxDelegatable.bandwidth)} trx bandwidth`
              : '…'}
          </dd>
        </div>
      </dl>
      {info && info.maxDelegatable.energy === 0 && info.maxDelegatable.bandwidth === 0 && (
        <div className="muted">Nothing to delegate. Stake TRX first (stake tab).</div>
      )}

      <Field label="receiver">
        <AddressInput value={to} onChange={setTo} keys={keys} exclude={from.address} />
      </Field>
      <div className="row">
        <Field label="resource">
          <select value={resource} onChange={(e) => setResource(e.target.value as Resource)}>
            <option value="ENERGY">energy</option>
            <option value="BANDWIDTH">bandwidth</option>
          </select>
        </Field>
        <Field label={`amount (trx staked, min 1, max ${fmt(max)})`}>
          <div className="row" style={{ gap: 6 }}>
            <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" style={{ width: 160 }} />
            <button className="ghost" disabled={!max} onClick={() => setAmount(String(Math.floor(max * 1e6) / 1e6))}>
              max
            </button>
          </div>
        </Field>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <label className="check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          lock
        </label>
        {lock && (
          <>
            <input
              value={lockDays}
              onChange={(e) => setLockDays(e.target.value.replace(/[^0-9.]/g, ''))}
              style={{ width: 70 }}
            />
            <span className="muted">
              days = {lockBlocks.toLocaleString('en-US')} blocks
              {info && <> (max {blocksToText(info.maxLockPeriodBlocks)})</>}
            </span>
          </>
        )}
      </div>
      {lock && <div className="muted small">A locked delegation cannot be reclaimed before the lock ends.</div>}
      {lockTooLong && <div className="error">Lock period is longer than the chain allows.</div>}
      {n > max && max > 0 && <div className="error">Amount is more than you can delegate.</div>}
      <TxOptionsInput value={permId} onChange={setPermId} />
      <FeeEstimate
        action="delegate"
        args={[to, n, resource, lockBlocks]}
        opts={toOpts(permId)}
        enabled={canDelegate}
      />
      <button
        className="primary"
        disabled={!canDelegate || busy}
        onClick={() =>
          runTx(
            `Delegate ${amount} TRX of ${resource.toLowerCase()} #${from.id} → ${short(to)}${lock ? ` (lock ${lockDays}d)` : ''}`,
            () => window.api.delegate(from.id, to, n, resource, lockBlocks, toOpts(permId))
          )
        }
      >
        delegate
      </button>

      <DelegationTable
        title="delegated out"
        empty="Nothing delegated to other addresses."
        rows={info?.out}
        keys={keys}
        onReclaim={(d, amt) =>
          runTx(`Reclaim ${amt} TRX of ${d.resource.toLowerCase()} #${from.id} ← ${short(d.address)}`, () =>
            window.api.undelegate(from.id, d.address, amt, d.resource, toOpts(permId))
          )
        }
        busy={busy}
      />
      <DelegationTable title="received" empty="No resources delegated to this address." rows={info?.in} keys={keys} />
    </div>
  )
}

function DelegationTable({ title, empty, rows, keys, onReclaim, busy }: {
  title: string
  empty: string
  rows?: Delegation[]
  keys: PublicKey[]
  onReclaim?: (d: Delegation, amount: number) => void
  busy?: boolean
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const now = Date.now()
  const name = (addr: string) => {
    const k = keys.find((x) => x.address === addr)
    return k ? `#${k.id}${k.label ? ` ${k.label}` : ''}` : ''
  }
  return (
    <div className="deleg-table">
      <div className="field-label">{title}</div>
      {!rows ? (
        <div className="muted">loading…</div>
      ) : rows.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <table className="nodes">
          <thead>
            <tr>
              <th>{onReclaim ? 'receiver' : 'from'}</th>
              <th>resource</th>
              <th>amount (trx)</th>
              <th>lock</th>
              {onReclaim && <th>reclaim</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const key = `${d.address}-${d.resource}`
              const locked = d.lockedUntil > now
              const amt = Number(amounts[key] ?? d.amount)
              return (
                <tr key={key}>
                  <td>
                    <span className="mono">{short(d.address)}</span> <span className="muted">{name(d.address)}</span>
                  </td>
                  <td>{d.resource.toLowerCase()}</td>
                  <td>{fmt(d.amount)}</td>
                  <td>
                    {locked ? (
                      <span className="warn">until {new Date(d.lockedUntil).toLocaleString('en-GB')}</span>
                    ) : (
                      <span className="muted">none</span>
                    )}
                  </td>
                  {onReclaim && (
                    <td className="nowrap">
                      <input
                        className="count"
                        style={{ width: 90 }}
                        value={amounts[key] ?? String(d.amount)}
                        onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
                        disabled={locked}
                      />{' '}
                      <button
                        className="small-btn"
                        disabled={busy || locked || !(amt > 0) || amt > d.amount}
                        title={locked ? 'Locked delegation' : undefined}
                        onClick={() => onReclaim(d, amt)}
                      >
                        reclaim
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
