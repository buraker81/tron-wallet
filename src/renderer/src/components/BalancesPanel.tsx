import type { Balances } from '../../../shared/types'
import { fmt, short } from '../ui'

export function BalancesPanel({ id, address, balances: b, error, onRetry }: {
  id: number
  address: string
  balances?: Balances
  error?: string
  onRetry?: () => void
}) {
  const used = b?.votes.reduce((s, v) => s + v.count, 0) ?? 0
  return (
    <div className="account">
      <div className="account-head">
        <span className="addr-id">{String(id).padStart(2, '0')}</span>
        <span className="account-addr">{address}</span>
        {b && !b.activated && <span className="tag warn">not activated</span>}
      </div>
      {b ? (
        <dl className="kv">
          <Row k="trx" v={fmt(b.trx)} strong />
          <Row k="usdt" v={b.usdt === null ? 'n/a' : fmt(b.usdt)} strong />
          <Row k="energy" v={`${fmt(Math.max(0, b.energy.limit - b.energy.used), 0)} / ${fmt(b.energy.limit, 0)}`} />
          <Row
            k="bandwidth"
            v={`${fmt(Math.max(0, b.bandwidth.limit - b.bandwidth.used), 0)} / ${fmt(b.bandwidth.limit, 0)}`}
          />
          <Row k="staked" v={b.frozen.length ? b.frozen.map((f) => `${fmt(f.amount)} ${f.type.toLowerCase()}`).join(', ') : '0'} />
          <Row k="tron power" v={`${fmt(b.tronPower, 0)} (${fmt(used, 0)} voted)`} />
          {(b.delegatedOut.energy > 0 || b.delegatedOut.bandwidth > 0) && (
            <Row k="delegated out" v={delegText(b.delegatedOut)} />
          )}
          {(b.delegatedIn.energy > 0 || b.delegatedIn.bandwidth > 0) && (
            <Row k="received" v={delegText(b.delegatedIn)} />
          )}
          {b.unfreezing.length > 0 && (
            <Row
              k="unstaking"
              v={b.unfreezing
                .map((u) => `${fmt(u.amount)} trx at ${new Date(u.expireAt).toLocaleString('en-GB')}`)
                .join(', ')}
            />
          )}
          {b.votes.length > 0 && (
            <Row k="votes" v={b.votes.map((v) => `${short(v.address)} ${fmt(v.count, 0)}`).join(', ')} />
          )}
        </dl>
      ) : error ? (
        <div className="load-error">
          <span className="error">failed to load: {error}</span>
          {onRetry && (
            <button className="link" onClick={onRetry}>
              retry
            </button>
          )}
        </div>
      ) : (
        <div className="muted pad">loading…</div>
      )}
    </div>
  )
}

const delegText = (d: { energy: number; bandwidth: number }) =>
  [d.energy > 0 && `${fmt(d.energy)} trx energy`, d.bandwidth > 0 && `${fmt(d.bandwidth)} trx bandwidth`]
    .filter(Boolean)
    .join(', ')

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="kv-row">
      <dt>{k}</dt>
      <dd className={strong ? 'strong' : ''}>{v}</dd>
    </div>
  )
}
