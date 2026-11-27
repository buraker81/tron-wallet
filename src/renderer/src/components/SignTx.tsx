import { useEffect, useState } from 'react'
import type { NetworkId, PublicKey, TxSummary } from '../../../shared/types'
import type { RunTx } from '../App'
import { short } from '../ui'

export interface PendingEntry {
  txid: string
  label: string
  json: string
  network: NetworkId
}

interface Props {
  keys: PublicKey[]
  network: NetworkId
  pending: PendingEntry[]
  /** currently opened tx json (lifted to App so the log can open a pending tx here) */
  json: string
  setJson: (json: string) => void
  onUpdated: (txid: string, json: string) => void
  onDone: (txid: string) => void
  runTx: RunTx
  busy: boolean
}

const fmtTime = (ms: number) => new Date(ms).toLocaleString('en-GB')
const left = (ms: number) => {
  const s = Math.round((ms - Date.now()) / 1000)
  if (s <= 0) return 'expired'
  if (s < 120) return `${s}s left`
  if (s < 7200) return `${Math.round(s / 60)} min left`
  return `${(s / 3600).toFixed(1)} h left`
}

export function SignTx({ keys, network, pending, json, setJson, onUpdated, onDone, runTx, busy }: Props) {
  const [summary, setSummary] = useState<TxSummary>()
  const [error, setError] = useState<string>()
  const [signers, setSigners] = useState<number[]>([])
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, tick] = useState(0)

  // re-inspect whenever the json or network changes
  // (the previous summary stays on screen until the new one arrives, so the page does not jump)
  useEffect(() => {
    setError(undefined)
    setSigners([])
    if (!json.trim()) {
      setSummary(undefined)
      return
    }
    let alive = true
    window.api
      .inspectTx(json)
      .then((s) => alive && setSummary(s))
      .catch((e) => {
        if (!alive) return
        setSummary(undefined)
        setError(e.message)
      })
    return () => {
      alive = false
    }
  }, [json, network])

  // keep the countdown fresh
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000)
    return () => clearInterval(t)
  }, [])

  const approved = new Set(summary?.approved ?? [])
  const keyByAddr = new Map(keys.map((k) => [k.address, k]))
  const candidates = (summary?.keys ?? [])
    .map((pk) => keyByAddr.get(pk.address))
    .filter((k): k is PublicKey => !!k && k.canSign && !approved.has(k.address))
  const ready = summary?.status === 'ENOUGH_PERMISSION'
  const expired = !!summary && summary.expiration <= Date.now()

  const sign = async () => {
    setWorking(true)
    setError(undefined)
    try {
      const r = await window.api.signTx(json, signers)
      setSummary(r.summary)
      setSigners([])
      onUpdated(r.summary.txid, r.json)
      setJson(r.json)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <div className="form">
      <div className="muted">
        Collect signatures for a multisig transaction. Paste a transaction JSON (from this app, TronWeb or
        wallet-cli) or open one that is waiting for signatures. It must be broadcast on the network it was built on
        ({network} now).
      </div>

      {pending.length > 0 && (
        <div className="field">
          <span>waiting for signatures</span>
          <div className="pending-list">
            {pending.map((p) => (
              <button
                key={p.txid}
                className={`pending-item ${p.json === json ? 'on' : ''}`}
                onClick={() => setJson(p.json)}
              >
                <span className="mono">{short(p.txid)}</span>
                <span>{p.label}</span>
                <span className="muted">{p.network}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="field">
        <span>transaction json</span>
        <textarea
          className="mono tx-json"
          rows={5}
          value={json}
          onChange={(e) => setJson(e.target.value)}
          placeholder='{"txID": "...", "raw_data": {...}, "raw_data_hex": "...", "signature": [...]}'
          spellCheck={false}
        />
      </label>
      {error && <div className="error">{error}</div>}

      {summary && (
        <>
          <dl className="kv single">
            <Row k="type" v={summary.contractType} />
            <Row k="account" v={`${summary.owner}${keyByAddr.get(summary.owner) ? `  (#${keyByAddr.get(summary.owner)!.id})` : ''}`} />
            {summary.params.map(([k, v]) => (
              <Row key={k} k={k.replace(/_/g, ' ')} v={v} />
            ))}
            {summary.note && <Row k="note" v={summary.note} />}
            <Row k="permission" v={`${summary.permissionName || '?'} (id ${summary.permissionId})`} />
            <Row
              k="expires"
              v={`${fmtTime(summary.expiration)} · ${left(summary.expiration)}`}
              cls={expired ? 'error' : ''}
            />
            <Row k="txid" v={summary.txid} />
          </dl>

          <div className="field">
            <span>
              signatures: weight {summary.weight} / {summary.threshold}
              {ready ? ' · ready to broadcast' : ''}
            </span>
            <table className="nodes">
              <thead>
                <tr>
                  <th>key</th>
                  <th>weight</th>
                  <th>in this app</th>
                  <th>signed</th>
                </tr>
              </thead>
              <tbody>
                {summary.keys.map((pk) => {
                  const k = keyByAddr.get(pk.address)
                  const done = approved.has(pk.address)
                  return (
                    <tr key={pk.address}>
                      <td className="mono">{pk.address}</td>
                      <td>{pk.weight}</td>
                      <td>
                        {k ? (
                          <>
                            #{k.id} {k.label && <span className="muted">{k.label}</span>}
                            {!k.canSign && <span className="warn"> watch-only</span>}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className={done ? 'ok' : 'muted'}>{done ? 'signed' : 'no'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {summary.statusMessage && !ready && <span className="muted small">{summary.statusMessage}</span>}
          </div>

          {!ready && !expired && (
            <div className="field">
              <span>sign with</span>
              {candidates.length === 0 ? (
                <div className="muted">
                  None of the remaining keys are in this app. Copy the JSON and send it to the other signers.
                </div>
              ) : (
                <div className="signers">
                  {candidates.map((k) => (
                    <label key={k.id} className="check">
                      <input
                        type="checkbox"
                        checked={signers.includes(k.id)}
                        onChange={(e) =>
                          setSigners((s) => (e.target.checked ? [...s, k.id] : s.filter((x) => x !== k.id)))
                        }
                      />
                      <span>
                        #{k.id} {short(k.address)} {k.label && <span className="muted">{k.label}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="row">
            {!ready && (
              <button className="primary" disabled={!signers.length || working || expired} onClick={sign}>
                {working ? 'signing…' : `sign (${signers.length})`}
              </button>
            )}
            <button
              className={ready ? 'primary' : ''}
              disabled={!ready || busy || expired}
              onClick={async () => {
                const txid = summary.txid
                const r = await runTx(`Broadcast ${summary.contractType} ${short(txid)}`, () =>
                  window.api.broadcastTx(json)
                )
                if (r?.ok) onDone(txid)
              }}
            >
              broadcast
            </button>
            <button
              className="ghost"
              onClick={() => {
                navigator.clipboard.writeText(json)
                setCopied(true)
                setTimeout(() => setCopied(false), 1200)
              }}
            >
              {copied ? 'copied' : 'copy json'}
            </button>
            <button className="ghost" onClick={() => setJson('')}>
              clear
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return (
    <div className="kv-row">
      <dt>{k}</dt>
      <dd className={`mono-wrap ${cls ?? ''}`}>{v}</dd>
    </div>
  )
}
