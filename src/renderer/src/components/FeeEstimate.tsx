import { useContext, useEffect, useState } from 'react'
import type { FeeEstimate as Estimate, TxAction, TxOptions } from '../../../shared/types'
import { TxContext, fmt } from '../ui'

const BW_SOURCE: Record<Estimate['bandwidth']['source'], string> = {
  staked: 'staked bandwidth',
  free: 'free bandwidth',
  burn: 'burned'
}

/**
 * Live fee / resource estimate for the tx a form would send. Re-estimates (debounced) when inputs change.
 * Built with the same builder as the real tx, so it reflects note, signers and permission id too.
 */
export function FeeEstimate({ action, args, opts, enabled }: {
  action: TxAction
  args: unknown[]
  opts?: TxOptions
  enabled: boolean
}) {
  const { from } = useContext(TxContext)
  const [est, setEst] = useState<Estimate>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const key = JSON.stringify([action, from?.id, args, opts ?? null])

  useEffect(() => {
    if (!enabled || !from) {
      setEst(undefined)
      setError(undefined)
      return
    }
    let alive = true
    setLoading(true)
    const timer = setTimeout(() => {
      window.api
        .estimateTx(action, from.id, args, opts)
        .then((e) => alive && (setEst(e), setError(undefined)))
        .catch((e) => alive && (setEst(undefined), setError(e.message)))
        .finally(() => alive && setLoading(false))
    }, 500)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [key, enabled])

  if (!enabled) return null
  if (error) return <div className="estimate muted">estimate unavailable: {error}</div>
  if (!est) return <div className="estimate muted">estimating…</div>

  const bw = est.bandwidth
  return (
    <div className={`estimate ${loading ? 'stale' : ''}`}>
      <div className="estimate-total">
        <span className="muted">estimated cost</span>
        <b>{est.totalTrx === 0 ? '0 trx (covered by resources)' : `≈ ${fmt(est.totalTrx, 4)} trx`}</b>
      </div>
      <div className="estimate-lines">
        <span>
          bandwidth {est.bytes} B · {BW_SOURCE[bw.source]}
          {bw.burnTrx > 0 && ` ${fmt(bw.burnTrx, 4)} trx`}
          <span className="muted">
            {' '}
            (staked {fmt(bw.available.staked, 0)}, free {fmt(bw.available.free, 0)})
          </span>
        </span>
        {est.energy.required > 0 && (
          <span>
            energy {fmt(est.energy.required, 0)}
            <span className="muted"> ({fmt(est.energy.available, 0)} available)</span>
            {est.energy.burnTrx > 0 ? ` · burns ${fmt(est.energy.burnTrx, 4)} trx` : ' · covered'}
          </span>
        )}
        {est.fees.map((f) => (
          <span key={f.label}>
            + {f.label} {fmt(f.trx, 4)} trx
          </span>
        ))}
        {est.warnings.map((w) => (
          <span key={w} className="warn">
            ! {w}
          </span>
        ))}
      </div>
    </div>
  )
}
