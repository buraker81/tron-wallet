import { useState } from 'react'
import type { NetworkId, NodeConfig, NodeState, NodeTestResult } from '../../../shared/types'
import { Field } from '../ui'

export const NETWORK_LABELS: Record<NetworkId, string> = { shasta: 'Shasta', nile: 'Nile', mainnet: 'Mainnet' }

const blank = (network: NetworkId): NodeConfig => ({
  id: '',
  name: '',
  network,
  fullHost: 'http://127.0.0.1:8090',
  apiKey: ''
})

const mask = (k?: string) => (!k ? '—' : k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`)

export function NodesModal({
  state,
  network,
  onState,
  onClose
}: {
  state: NodeState
  network: NetworkId
  onState: (s: NodeState) => void
  onClose: () => void
}) {
  const [editing, setEditing] = useState<NodeConfig>()
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [tests, setTests] = useState<Record<string, NodeTestResult | 'testing'>>({})
  const [error, setError] = useState<string>()

  const run = async (fn: () => Promise<NodeState>) => {
    setError(undefined)
    try {
      onState(await fn())
      return true
    } catch (e: any) {
      setError(e.message)
      return false
    }
  }

  const test = async (node: NodeConfig, key = node.id) => {
    setTests((t) => ({ ...t, [key]: 'testing' }))
    const r = await window.api.testNode(node)
    setTests((t) => ({ ...t, [key]: r }))
  }

  const nets = Object.keys(NETWORK_LABELS) as NetworkId[]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3>nodes</h3>
          <div className="spacer" />
          <button onClick={() => setEditing(blank(network))}>+ Add node</button>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="muted small">
          Saved locally in <span className="mono">{state.path}</span> (git-ignored, contains API keys).
        </div>
        {error && <div className="error">{error}</div>}

        <table className="nodes">
          <thead>
            <tr>
              <th>Active</th>
              <th>Name</th>
              <th>Network</th>
              <th>Full host</th>
              <th>API key</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {nets.flatMap((net) =>
              state.nodes
                .filter((n) => n.network === net)
                .map((n) => {
                  const t = tests[n.id]
                  return (
                    <tr key={n.id}>
                      <td>
                        <input
                          type="radio"
                          name={`sel-${net}`}
                          checked={state.selected[net] === n.id}
                          onChange={() => run(() => window.api.selectNode(net, n.id))}
                        />
                      </td>
                      <td>
                        {n.name} {n.builtin && <span className="muted small">(built-in)</span>}
                      </td>
                      <td>
                        <span className={`net-tag ${net}`}>{NETWORK_LABELS[net]}</span>
                      </td>
                      <td className="mono">{n.fullHost}</td>
                      <td className="mono">
                        {reveal[n.id] ? n.apiKey || '—' : mask(n.apiKey)}{' '}
                        {n.apiKey && (
                          <button className="link" onClick={() => setReveal((r) => ({ ...r, [n.id]: !r[n.id] }))}>
                            {reveal[n.id] ? 'Hide' : 'Show'}
                          </button>
                        )}
                      </td>
                      <td>
                        <TestStatus t={t} />
                      </td>
                      <td className="nowrap">
                        <button className="link" onClick={() => test(n)}>
                          Test
                        </button>
                        <button className="link" onClick={() => setEditing({ ...n })}>
                          Edit
                        </button>
                        {!n.builtin && (
                          <button className="link" onClick={() => run(() => window.api.deleteNode(n.id))}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })
            )}
          </tbody>
        </table>

        {editing && (
          <div className="card form" style={{ maxWidth: 'none', marginTop: 12 }}>
            <b>{editing.id ? `Edit ${editing.name}` : 'Add node'}</b>
            <div className="row">
              <Field label="Name">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="My local node" />
              </Field>
              <Field label="Network">
                <select
                  value={editing.network}
                  disabled={editing.builtin}
                  onChange={(e) => setEditing({ ...editing, network: e.target.value as NetworkId })}
                >
                  {nets.map((n) => (
                    <option key={n} value={n}>
                      {NETWORK_LABELS[n]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Full host (HTTP API, e.g. http://127.0.0.1:8090)">
              <input
                className="mono"
                value={editing.fullHost}
                disabled={editing.builtin}
                onChange={(e) => setEditing({ ...editing, fullHost: e.target.value })}
              />
            </Field>
            <div className="row">
              <Field label="API key (optional)">
                <input
                  className="mono"
                  style={{ width: 340 }}
                  value={editing.apiKey ?? ''}
                  onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
                />
              </Field>
              <Field label="API key header">
                <input
                  className="mono"
                  value={editing.apiKeyHeader ?? ''}
                  placeholder="TRON-PRO-API-KEY"
                  onChange={(e) => setEditing({ ...editing, apiKeyHeader: e.target.value })}
                />
              </Field>
            </div>
            <div className="row" style={{ alignItems: 'center' }}>
              <button
                className="primary"
                onClick={async () => {
                  if (await run(() => window.api.saveNode(editing))) setEditing(undefined)
                }}
              >
                Save
              </button>
              <button onClick={() => test(editing, '__form')}>Test connection</button>
              <button onClick={() => setEditing(undefined)}>Cancel</button>
              <TestStatus t={tests.__form} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TestStatus({ t }: { t?: NodeTestResult | 'testing' }) {
  if (!t) return <span className="muted small">—</span>
  if (t === 'testing') return <span className="muted small">Testing…</span>
  return t.ok ? (
    <span className="ok small">
      OK · block {t.block?.toLocaleString('en-US')} · {t.latencyMs} ms
    </span>
  ) : (
    <span className="error small" title={t.error}>
      Failed: {t.error}
    </span>
  )
}
