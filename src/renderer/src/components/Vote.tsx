import { useEffect, useState } from 'react'
import type { RewardInfo } from '../../../shared/types'
import type { Balances, NetworkId, PublicKey, SR } from '../../../shared/types'
import type { RunTx } from '../App'
import { TxOptionsInput, EMPTY_TX_OPTS, fmt, short, toOpts, type TxOptsState } from '../ui'
import { FeeEstimate } from './FeeEstimate'

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
  const [permId, setPermId] = useState(EMPTY_TX_OPTS)

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
      <Rewards from={from} balances={balances} network={network} runTx={runTx} busy={busy} permId={permId} />
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
      <TxOptionsInput value={permId} onChange={setPermId} />
      <FeeEstimate
        action="vote"
        args={[payload]}
        opts={toOpts(permId)}
        enabled={Object.keys(payload).length > 0 && total <= power}
      />
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

/** Unclaimed voting rewards + claim (WithdrawBalance, once per 24 h). */
function Rewards({ from, balances, network, runTx, busy, permId }: {
  from: PublicKey
  balances?: Balances
  network: NetworkId
  runTx: RunTx
  busy: boolean
  permId: TxOptsState
}) {
  const [info, setInfo] = useState<RewardInfo>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    setError(undefined)
    window.api.rewardInfo(from.address).then(setInfo).catch((e) => setError(e.message))
  }, [from.address, network, balances])

  const cooling = !!info && info.nextClaim > Date.now()
  return (
    <div className="rewards">
      <div className="row" style={{ alignItems: 'center' }}>
        <span className="muted">voting rewards</span>
        <b>{info ? `${fmt(info.claimable)} trx` : error ? '—' : '…'}</b>
        {info && info.lastClaim > 0 && (
          <span className="muted small">last claim {new Date(info.lastClaim).toLocaleString('en-GB')}</span>
        )}
        <span className="spacer" />
        <button
          disabled={busy || !info || info.claimable <= 0 || cooling}
          title={cooling ? 'Rewards can be claimed once every 24 hours' : undefined}
          onClick={() =>
            runTx(`Claim ${fmt(info!.claimable)} TRX voting rewards #${from.id}`, () =>
              window.api.claimRewards(from.id, toOpts(permId))
            )
          }
        >
          claim
        </button>
      </div>
      {cooling && (
        <div className="muted small">next claim possible after {new Date(info!.nextClaim).toLocaleString('en-GB')}</div>
      )}
      {error && <div className="error small">{error}</div>}
      {info && info.claimable > 0 && !cooling && (
        <FeeEstimate action="claimRewards" args={[]} opts={toOpts(permId)} enabled />
      )}
    </div>
  )
}
