import { useEffect, useState } from 'react'
import type { AccountPermissions, NetworkId, Permission, PublicKey } from '../../../shared/types'
import type { RunTx } from '../App'
import { AddressInput, Field, TxOptionsInput, EMPTY_TX_OPTS, toOpts } from '../ui'
import { DEFAULT_OPS } from '../../../shared/operations'
import { OperationsEditor } from './OperationsEditor'

interface Props {
  from: PublicKey
  keys: PublicKey[]
  network: NetworkId
  runTx: RunTx
  busy: boolean
}

const blankOwner = (addr: string): Permission => ({
  type: 0,
  permission_name: 'owner',
  threshold: 1,
  keys: [{ address: addr, weight: 1 }]
})
const blankActive = (addr: string, n: number): Permission => ({
  type: 2,
  permission_name: `active${n}`,
  threshold: 1,
  operations: DEFAULT_OPS,
  keys: [{ address: addr, weight: 1 }]
})

export function Permissions({ from, keys, network, runTx, busy }: Props) {
  const [current, setCurrent] = useState<AccountPermissions>()
  const [error, setError] = useState<string>()
  const [owner, setOwner] = useState<Permission>(blankOwner(from.address))
  const [actives, setActives] = useState<Permission[]>([])
  const [permId, setPermId] = useState(EMPTY_TX_OPTS)

  const load = () => {
    setError(undefined)
    window.api
      .getPermissions(from.address)
      .then((p) => {
        setCurrent(p)
        setOwner(p.owner ?? blankOwner(from.address))
        setActives(p.actives.length ? p.actives : [blankActive(from.address, 0)])
      })
      .catch((e) => setError(e.message))
  }
  useEffect(load, [from.address, network])

  const submit = () => {
    const clean = (p: Permission): Permission => ({
      type: p.type,
      permission_name: p.permission_name,
      threshold: Number(p.threshold),
      ...(p.type === 2 ? { operations: p.operations || DEFAULT_OPS } : {}),
      keys: p.keys.filter((k) => k.address).map((k) => ({ address: k.address, weight: Number(k.weight) }))
    })
    runTx(`Update permissions #${from.id} (owner thr ${owner.threshold}, ${actives.length} active)`, () =>
      window.api.updatePermissions(from.id, clean(owner), actives.map(clean), toOpts(permId))
    )
  }

  return (
    <div className="form">
      <div className="warn">
        Careful: if the owner permission doesn't include keys you control (with enough weight to reach the
        threshold), the account is locked forever. Updating permissions costs 100 TRX.
      </div>
      {error && <div className="error">{error}</div>}
      {!current && !error && <div className="muted small">Loading permissions…</div>}
      {current && !current.owner && (
        <div className="muted small">No permissions set on-chain for this account (defaults apply). Showing a default template.</div>
      )}

      <PermEditor title="Owner permission" perm={owner} onChange={setOwner} keys={keys} />

      {actives.map((a, i) => (
        <PermEditor
          key={i}
          title={`Active permission ${a.id !== undefined ? `(id ${a.id})` : '(new)'}`}
          perm={a}
          keys={keys}
          onChange={(p) => setActives((xs) => xs.map((x, j) => (j === i ? p : x)))}
          onRemove={actives.length > 1 ? () => setActives((xs) => xs.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      <div className="row">
        <button onClick={() => setActives((xs) => [...xs, blankActive(from.address, xs.length)])}>
          + Add active permission
        </button>
        <button onClick={load}>Reset to on-chain</button>
      </div>
      <TxOptionsInput value={permId} onChange={setPermId} />
      <button className="primary danger" disabled={busy} onClick={submit}>
        Update account permissions
      </button>
    </div>
  )
}

function PermEditor({
  title,
  perm,
  onChange,
  onRemove,
  keys
}: {
  title: string
  perm: Permission
  onChange: (p: Permission) => void
  onRemove?: () => void
  keys: PublicKey[]
}) {
  const totalWeight = perm.keys.reduce((s, k) => s + (Number(k.weight) || 0), 0)
  const setKey = (i: number, patch: Partial<Permission['keys'][number]>) =>
    onChange({ ...perm, keys: perm.keys.map((k, j) => (j === i ? { ...k, ...patch } : k)) })

  return (
    <div className="card perm">
      <div className="row">
        <b>{title}</b>
        <div className="spacer" />
        {onRemove && (
          <button className="link" onClick={onRemove}>
            Remove
          </button>
        )}
      </div>
      <div className="row">
        <Field label="Name">
          <input value={perm.permission_name} onChange={(e) => onChange({ ...perm, permission_name: e.target.value })} />
        </Field>
        <Field label={`Threshold (total weight ${totalWeight})`}>
          <input
            value={perm.threshold}
            className={Number(perm.threshold) > totalWeight ? 'invalid' : ''}
            onChange={(e) => onChange({ ...perm, threshold: Number(e.target.value.replace(/[^0-9]/g, '')) })}
            style={{ width: 120 }}
          />
        </Field>
      </div>
      {perm.type === 2 && (
        <OperationsEditor
          value={perm.operations ?? DEFAULT_OPS}
          onChange={(operations) => onChange({ ...perm, operations })}
        />
      )}
      {perm.keys.map((k, i) => (
        <div key={i} className="row key-row">
          <AddressInput value={k.address} onChange={(v) => setKey(i, { address: v })} keys={keys} />
          <input
            value={k.weight}
            style={{ width: 70 }}
            title="Weight"
            onChange={(e) => setKey(i, { weight: Number(e.target.value.replace(/[^0-9]/g, '')) })}
          />
          <button className="link" onClick={() => onChange({ ...perm, keys: perm.keys.filter((_, j) => j !== i) })}>
            ✕
          </button>
        </div>
      ))}
      <button className="link" onClick={() => onChange({ ...perm, keys: [...perm.keys, { address: '', weight: 1 }] })}>
        + Add key
      </button>
    </div>
  )
}
