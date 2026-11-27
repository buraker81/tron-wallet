import type { Balances } from '../../../shared/types'
import { fmt, short } from '../ui'

export function BalancesPanel({ id, address, balances: b }: { id: number; address: string; balances?: Balances }) {
  return (
    <div className="card">
      <div className="card-head">
        <span className="addr-id">#{id}</span>
        <span className="mono select">{address}</span>
        {b && !b.activated && <span className="warn small">Not activated (send some TRX to activate)</span>}
      </div>
      {b ? (
        <div className="stats">
          <Stat label="TRX" value={fmt(b.trx)} />
          <Stat label="USDT" value={b.usdt === null ? 'n/a' : fmt(b.usdt)} />
          <Stat label="Energy" value={`${fmt(b.energy.limit - b.energy.used, 0)} / ${fmt(b.energy.limit, 0)}`} />
          <Stat
            label="Bandwidth"
            value={`${fmt(b.bandwidth.limit - b.bandwidth.used, 0)} / ${fmt(b.bandwidth.limit, 0)}`}
          />
          <Stat
            label="Staked"
            value={b.frozen.length ? b.frozen.map((f) => `${fmt(f.amount)} ${f.type}`).join(' · ') : '0'}
          />
          <Stat label="Tron Power" value={`${fmt(b.tronPower, 0)} (used ${b.votes.reduce((s, v) => s + v.count, 0)})`} />
          {b.unfreezing.length > 0 && (
            <Stat
              label="Unstaking"
              value={b.unfreezing
                .map((u) => `${fmt(u.amount)} TRX @ ${new Date(u.expireAt).toLocaleString('en-GB')}`)
                .join(' · ')}
            />
          )}
          {b.votes.length > 0 && (
            <Stat label="Votes" value={b.votes.map((v) => `${short(v.address)}: ${v.count}`).join(' · ')} />
          )}
        </div>
      ) : (
        <div className="muted small">Loading balances…</div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}
