import { useEffect, useState } from 'react'
import type { Balances, NetworkId, PublicKey, SR } from '../../../shared/types'
import type { RunTx } from '../App'
import { PermissionIdInput, fmt, short, toOpts } from '../ui'

interface Props {
  from: PublicKey
  keys: PublicKey[]
  balances?: Balances
  network: NetworkId
  runTx: RunTx
  busy: boolean
}

export function Vote({ from, balances, network, runTx, busy }: Props) {
  const [srs, setSrs] = useState<SR[]>([])
  const [error, setError] = useState<string>()
  const [votes, setVotes] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState('')
  const [permId, setPermId] = useState('')

  useEffect(() => {
    setSrs([])
    setError(undefined)
    window.api.listSRs().then(setSrs).catch((e) => setError(e.message))
  }, [network])

  // prefill with current votes
  useEffect(() => {
    const cur: Record<string, string> = {}
    balances?.votes.forEach((v) => (cur[v.address] = String(v.count)))
    setVotes(cur)
  }, [from.id, balances?.votes])

  const total = Object.values(votes).reduce((s, v) => s + (Number(v) || 0), 0)
  const power = balances?.tronPower ?? 0
  const payload = Object.fromEntries(
    Object.entries(votes)
      .filter(([, v]) => Number(v) > 0)
      .map(([k, v]) => [k, Math.floor(Number(v))])
  )
  const shown = srs.filter(
    (s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.address.includes(filter)
  )

  return (
    <div className="form">
      <div className="row">
        <span>
          Tron Power: <b>{fmt(power, 0)}</b> · Allocated: <b className={total > power ? 'error' : ''}>{total}</b>
        </span>
        <div className="spacer" />
        <input placeholder="Filter SRs…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="muted small">A vote transaction replaces all your previous votes.</div>
      {error && <div className="error">{error}</div>}
      <div className="sr-list">
        {shown.length === 0 && !error && <div className="muted small">Loading SRs…</div>}
        {shown.map((s) => (
          <div key={s.address} className="sr-row">
            <span className="sr-name" title={s.name}>
              {s.name}
            </span>
            <span className="mono muted">{short(s.address)}</span>
            <span className="muted small">{fmt(s.votes, 0)} votes</span>
            <input
              className="vote-input"
              value={votes[s.address] ?? ''}
              placeholder="0"
              onChange={(e) => setVotes((v) => ({ ...v, [s.address]: e.target.value.replace(/[^0-9]/g, '') }))}
            />
          </div>
        ))}
      </div>
      <PermissionIdInput value={permId} onChange={setPermId} />
      <button
        className="primary"
        disabled={busy || Object.keys(payload).length === 0 || total > power}
        onClick={() =>
          runTx(`Vote ${total} TP across ${Object.keys(payload).length} SR(s) #${from.id}`, () =>
            window.api.vote(from.id, payload, toOpts(permId))
          )
        }
      >
        Submit votes
      </button>
    </div>
  )
}
