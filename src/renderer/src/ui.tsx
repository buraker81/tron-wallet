import { createContext, useContext, type ReactNode } from 'react'
import type { PublicKey, TxOptions } from '../../shared/types'

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
export const TxContext = createContext<{ keys: PublicKey[]; from?: PublicKey; memoFee: number }>({ keys: [], memoFee: 0 })

/**
 * Note + signing options shown under every transaction form.
 * Leaving signers empty signs with the account's own key (the normal case).
 */
export function TxOptionsInput({ value, onChange }: { value: TxOptsState; onChange: (v: TxOptsState) => void }) {
  const { keys, from, memoFee } = useContext(TxContext)
  const set = (patch: Partial<TxOptsState>) => onChange({ ...value, ...patch })
  const signable = keys.filter((k) => k.canSign)
  const ownCantSign = !!from && !from.canSign
  const advanced = value.permId !== '' || value.signers.length > 0 || value.expireMinutes !== ''
  const multi = value.signers.length > 1 || (value.signers.length === 1 && value.signers[0] !== from?.id)
  const noteBytes = new TextEncoder().encode(value.note.trim()).length

  return (
    <div className="tx-opts">
      <Field label={`note (optional, stored on chain${memoFee ? `, adds ${memoFee} trx fee` : ''})`}>
        <input value={value.note} onChange={(e) => set({ note: e.target.value })} placeholder="memo" maxLength={512} />
      </Field>
      {noteBytes > 0 && <span className="muted small">{noteBytes} bytes</span>}

      <details open={advanced || ownCantSign}>
        <summary>
          signing
          <span className="muted">
            {' '}
            {value.signers.length
              ? `· ${value.signers.map((id) => `#${id}`).join(', ')}`
              : ownCantSign
                ? '· pick signers (account is watch-only)'
                : '· own key'}
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
                placeholder={multi ? '60' : '1'}
                style={{ width: 140 }}
              />
            </Field>
          </div>
          <div className="field">
            <span>signers (empty = account's own key)</span>
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
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="muted small">
            If the signers reach the permission threshold the tx is broadcast. Otherwise it is kept as a partially
            signed tx in the sign-tx tab, where more signatures can be added (or the JSON shared).
            {multi && !value.expireMinutes && ' Set "valid for" if other people still need to sign.'}
          </div>
        </div>
      </details>
    </div>
  )
}
