import type { Balances } from '../../../shared/types'
import { fmt, short } from '../ui'

export function BalancesPanel({ id, address, balances: b }: { id: number; address: string; balances?: Balances }) {
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
      ) : (
        <div className="muted pad">loading…</div>
      )}
    </div>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="kv-row">
      <dt>{k}</dt>
      <dd className={strong ? 'strong' : ''}>{v}</dd>
    </div>
  )
}
