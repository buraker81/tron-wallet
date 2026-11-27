import { useEffect, useState } from 'react'
import {
  OPERATIONS,
  OPERATION_GROUPS,
  PRESETS,
  decodeOperations,
  encodeOperations
} from '../../../shared/operations'

const KNOWN = new Set(OPERATIONS.map((o) => o.id))

/** Checkbox editor for an active permission's operations bitmask, synced with a raw hex field. */
export function OperationsEditor({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [raw, setRaw] = useState(value)
  useEffect(() => setRaw(value), [value])

  const enabled = new Set(decodeOperations(value) ?? [])
  const unknown = [...enabled].filter((id) => !KNOWN.has(id))
  const rawValid = decodeOperations(raw) !== null

  const set = (ids: Iterable<number>) => onChange(encodeOperations(ids))
  const toggle = (id: number) => {
    const next = new Set(enabled)
    next.has(id) ? next.delete(id) : next.add(id)
    set(next)
  }
  const toggleGroup = (group: string, on: boolean) => {
    const next = new Set(enabled)
    OPERATIONS.filter((o) => o.group === group).forEach((o) => (on ? next.add(o.id) : next.delete(o.id)))
    set(next)
  }

  return (
    <div className="ops">
      <div className="row">
        <span className="field-label">Operations ({enabled.size} allowed)</span>
        <div className="spacer" />
        <select value="" onChange={(e) => e.target.value !== '' && set(PRESETS[Number(e.target.value)].ids)}>
          <option value="">Apply preset…</option>
          {PRESETS.map((p, i) => (
            <option key={p.name} value={i}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="ops-grid">
        {OPERATION_GROUPS.map((group) => {
          const items = OPERATIONS.filter((o) => o.group === group)
          const all = items.every((o) => enabled.has(o.id))
          return (
            <div key={group} className="ops-group">
              <label className="ops-group-title">
                <input type="checkbox" checked={all} onChange={() => toggleGroup(group, !all)} />
                {group}
              </label>
              {items.map((o) => (
                <label key={o.id} className={`ops-item ${o.id === 46 ? 'warn' : ''}`}>
                  <input type="checkbox" checked={enabled.has(o.id)} onChange={() => toggle(o.id)} />
                  <span>{o.name}</span>
                  <span className="muted small">#{o.id}</span>
                </label>
              ))}
            </div>
          )
        })}
      </div>

      {enabled.has(46) && (
        <div className="warn small">
          AccountPermissionUpdate is enabled: this active permission can change (and lock) the account's permissions.
        </div>
      )}
      {unknown.length > 0 && (
        <div className="muted small">Other bits set (kept as-is): {unknown.join(', ')}</div>
      )}

      <label className="field">
        <span>Raw hex (edit or paste; checkboxes update when valid)</span>
        <input
          className={`mono ${rawValid ? '' : 'invalid'}`}
          value={raw}
          onChange={(e) => {
            const v = e.target.value.trim()
            setRaw(v)
            const ids = decodeOperations(v)
            if (ids) onChange(encodeOperations(ids))
          }}
        />
      </label>
      {!rawValid && <div className="error small">Must be exactly 64 hex characters (32 bytes).</div>}
    </div>
  )
}
