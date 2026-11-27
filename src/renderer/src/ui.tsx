import type { ReactNode } from 'react'
import type { PublicKey } from '../../shared/types'

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

export function PermissionIdInput({
  value,
  onChange
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <Field label="Permission ID (optional, for multisig)">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        placeholder="0 = owner, 2+ = active"
        style={{ width: 200 }}
      />
    </Field>
  )
}

export const toOpts = (permId: string) => (permId === '' ? undefined : { permissionId: Number(permId) })
