import { createContext, useContext, type ReactNode } from 'react'
import type { AccountPermissions, Permission, PublicKey, TxOptions } from '../../shared/types'
import { pickSigners } from '../../shared/signers'

export const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a)
export const fmt = (n: number, d = 6) => n.toLocaleString('en-US', { maximumFractionDigits: d })

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/** Free-text address input with a quick-pick list of keys.json addresses. */
export function AddressInput({
  value,
  onChange,
  keys,
  exclude
}: {
  value: string
  onChange: (v: string) => void
  keys: PublicKey[]
  exclude?: string
}) {
  return (
    <div className="addr-input">
      <input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="T..." />
      <select value="" onChange={(e) => e.target.value && onChange(e.target.value)}>
        <option value="">Pick from keys…</option>
        {keys
          .filter((k) => k.address !== exclude)
          .map((k) => (
            <option key={k.id} value={k.address}>
              #{k.id} {short(k.address)}
            </option>
          ))}
      </select>
    </div>
  )
}

export interface TxOptsState {
  permId: string
  note: string
  signers: number[]
  expireMinutes: string
}
export const EMPTY_TX_OPTS: TxOptsState = { permId: '', note: '', signers: [], expireMinutes: '' }

export const toOpts = (o: TxOptsState): TxOptions | undefined => {
  const opts: TxOptions = {}
  if (o.permId !== '') opts.permissionId = Number(o.permId)
  if (o.note.trim()) opts.note = o.note.trim()
  if (o.signers.length) opts.signers = o.signers
  if (Number(o.expireMinutes) > 1) opts.expireMinutes = Number(o.expireMinutes)
  return Object.keys(opts).length ? opts : undefined
}

/** Shared by the app: address book, selected account, network memo fee. */
export const TxContext = createContext<{
  keys: PublicKey[]
  from?: PublicKey
  memoFee: number
  /** on-chain permissions of `from`, when loaded */
  perms?: AccountPermissions
}>({ keys: [], memoFee: 0 })

/** The permission a tx will use: owner (0) unless an id is given. Accounts without custom permissions = own key. */
export function permissionFor(perms: AccountPermissions | undefined, from: PublicKey, permId: string): Permission | undefined {
  const id = permId === '' ? 0 : Number(permId)
  if (id === 0) {
    return (
      perms?.owner ?? { type: 0, id: 0, permission_name: 'owner', threshold: 1, keys: [{ address: from.address, weight: 1 }] }
    )
  }
  if (id === 1) return perms?.witness ?? undefined
  return perms?.actives.find((a) => (a.id ?? 2) === id)
}

/**
 * Note + signing options shown under every transaction form.
 * Leaving signers empty signs with the account's own key (the normal case).
 */
export function TxOptionsInput({ value, onChange }: { value: TxOptsState; onChange: (v: TxOptsState) => void }) {
  const { keys, from, memoFee, perms } = useContext(TxContext)
  const set = (patch: Partial<TxOptsState>) => onChange({ ...value, ...patch })
  const signable = keys.filter((k) => k.canSign)
  const noteBytes = new TextEncoder().encode(value.note.trim()).length

  // who signs when no signers are picked: keys this app holds for the permission (same rule as the backend)
  const perm = from ? permissionFor(perms, from, value.permId) : undefined
  const permKeys = new Set(perm?.keys.map((k) => k.address) ?? [])
  const auto = perm && from ? pickSigners(perm.keys, perm.threshold, keys, from.id) : undefined
  const autoIsOwnKey = !!auto && auto.ids.length === 1 && auto.ids[0] === from?.id && auto.enough
  // will the chosen (or automatic) signers reach the threshold? if not, the tx waits for more signatures
  const weightOf = new Map(perm?.keys.map((k) => [k.address, Number(k.weight)]) ?? [])
  const explicitWeight = [...new Set(value.signers.map((id) => keys.find((k) => k.id === id)?.address))].reduce(
    (sum, addr) => sum + (addr ? (weightOf.get(addr) ?? 0) : 0),
    0
  )
  const pendingLikely = !!perm && (value.signers.length ? explicitWeight < perm.threshold : !!auto && !auto.enough)
  const unusual = !!perms && !value.signers.length && !autoIsOwnKey // owner moved, multisig, or nobody can sign
  const advanced = value.permId !== '' || value.signers.length > 0 || value.expireMinutes !== '' || unusual
  const permLabel = perm ? `${perm.permission_name} ${auto?.weight ?? 0}/${perm.threshold}` : ''
  const ids = (list: number[]) =>
    list
      .map((id) => {
        const k = keys.find((x) => x.id === id)
        return k ? `#${id} ${short(k.address)}` : `#${id}`
      })
      .join(', ')

  let summary: React.ReactNode
  if (value.signers.length) summary = `· ${ids(value.signers)}`
  else if (!perms) summary = '· own key'
  else if (!perm) summary = <span className="error">· permission {value.permId} does not exist on this account</span>
  else if (!auto || auto.ids.length === 0)
    summary = <span className="error">· no key in this app can sign for "{perm.permission_name}"</span>
  else if (autoIsOwnKey) summary = '· own key'
  else
    summary = (
      <span className={auto.enough ? '' : 'warn'}>
        · auto: {ids(auto.ids)} ({permLabel}
        {auto.enough ? '' : ', needs more signatures'})
      </span>
    )

  return (
    <div className="tx-opts">
      <Field label={`note (optional, stored on chain${memoFee ? `, adds ${memoFee} trx fee` : ''})`}>
        <input value={value.note} onChange={(e) => set({ note: e.target.value })} placeholder="memo" maxLength={512} />
      </Field>
      {noteBytes > 0 && <span className="muted small">{noteBytes} bytes</span>}

      <details open={advanced}>
        <summary>
          signing
          <span className="muted">
            {' '}
            {summary}
            {value.permId !== '' && ` · permission ${value.permId}`}
          </span>
        </summary>
        <div className="tx-opts-body">
          <div className="row">
            <Field label="permission id">
              <input
                value={value.permId}
                onChange={(e) => set({ permId: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder="0 owner, 2+ active"
                style={{ width: 170 }}
              />
            </Field>
            <Field label="valid for (minutes)">
              <input
                value={value.expireMinutes}
                onChange={(e) => set({ expireMinutes: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder={pendingLikely ? '60' : '1'}
                style={{ width: 140 }}
              />
            </Field>
          </div>
          <div className="field">
            <span>
              signers (empty = automatic: keys in this app that belong to the{' '}
              {perm ? `"${perm.permission_name}"` : 'selected'} permission)
            </span>
            <div className="signers">
              {signable.map((k) => (
                <label key={k.id} className="check">
                  <input
                    type="checkbox"
                    checked={value.signers.includes(k.id)}
                    onChange={(e) =>
                      set({
                        signers: e.target.checked
                          ? [...value.signers, k.id]
                          : value.signers.filter((x) => x !== k.id)
                      })
                    }
                  />
                  <span>
                    #{k.id} {short(k.address)}
                    {k.label && <span className="muted"> {k.label}</span>}
                    {permKeys.has(k.address) && <span className="ok"> · in {perm?.permission_name}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="muted small">
            If the signers reach the permission threshold the tx is broadcast. Otherwise it is kept as a partially
            signed tx in the sign-tx tab, where more signatures can be added (or the JSON shared).
            {pendingLikely &&
              !value.expireMinutes &&
              ` These signers don't reach the threshold (${perm!.threshold}): set "valid for" so the others have time to sign.`}
          </div>
        </div>
      </details>
    </div>
  )
}
