import { useEffect, useState } from 'react'
import type { HistoryItem, NetworkId, PublicKey } from '../../../shared/types'
import { fmt, short } from '../ui'

type Kind = 'all' | 'trc20'
const ARROW: Record<HistoryItem['direction'], string> = { in: '←', out: '→', self: '↺', other: '·' }
const when = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
// shorter labels for the long contract type names
const TYPE: Record<string, string> = {
  TriggerSmartContract: 'contract call',
  FreezeBalanceV2: 'stake',
  UnfreezeBalanceV2: 'unstake',
  WithdrawExpireUnfreeze: 'withdraw unstaked',
  CancelAllUnfreezeV2: 'cancel unstakes',
  DelegateResource: 'delegate',
  UnDelegateResource: 'reclaim',
  VoteWitness: 'vote',
  WithdrawBalance: 'claim rewards',
  AccountPermissionUpdate: 'permission update',
  Transfer: 'transfer',
  TransferAsset: 'trc10 transfer'
}

export function History({ from, keys, network }: { from: PublicKey; keys: PublicKey[]; network: NetworkId }) {
  const [kind, setKind] = useState<Kind>('all')
  const [items, setItems] = useState<HistoryItem[]>([])
  const [next, setNext] = useState<string>()
  const [source, setSource] = useState<{ host: string; fallback: boolean }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [explorer, setExplorer] = useState('')

  const load = async (fingerprint?: string) => {
    setLoading(true)
    setError(undefined)
    try {
      const page = await window.api.history(from.address, kind, fingerprint)
      setItems((cur) => (fingerprint ? [...cur, ...page.items] : page.items))
      setNext(page.items.length ? page.next : undefined)
      setSource({ host: page.source, fallback: page.fallback })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setItems([])
    setNext(undefined)
    load()
    window.api.explorerUrl('').then(setExplorer)
  }, [from.address, kind, network])

  const name = (addr?: string) => {
    if (!addr) return ''
    const k = keys.find((x) => x.address === addr)
    return k ? `#${k.id}${k.label ? ` ${k.label}` : ''}` : ''
  }

  return (
    <div className="form history">
      <div className="row" style={{ alignItems: 'center' }}>
        <nav className="seg">
          {(['all', 'trc20'] as Kind[]).map((k) => (
            <button key={k} className={k === kind ? 'on' : ''} onClick={() => setKind(k)}>
              {k === 'all' ? 'transactions' : 'trc20 transfers'}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {source && (
          <span className="muted small">
            from {source.host}
            {source.fallback && ' (active node has no history API, using TronGrid)'}
          </span>
        )}
        <button className="ghost" onClick={() => load()} disabled={loading}>
          reload
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {!loading && !error && items.length === 0 && <div className="muted">No transactions found.</div>}

      {items.length > 0 && (
        <div className="table-scroll">
        <table className="nodes hist">
          <thead>
            <tr>
              <th>time</th>
              <th>type</th>
              <th />
              <th>counterparty</th>
              <th>amount</th>
              {kind === 'all' && <th>fee · energy · bw</th>}
              <th>result</th>
              <th>tx</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.txid + x.type + x.amount}>
                <td className="nowrap muted">{when(x.time)}</td>
                <td>
                  <span title={x.type}>{TYPE[x.type] ?? x.type}</span>
                  {x.note && <div className="muted small note" title={x.note}>“{x.note}”</div>}
                </td>
                <td className={`dir ${x.direction}`}>{ARROW[x.direction]}</td>
                <td className="nowrap" title={x.counterparty}>
                  {x.counterparty ? short(x.counterparty) : ''} <span className="muted">{name(x.counterparty)}</span>
                </td>
                <td className="nowrap">{x.amount ?? ''}</td>
                {kind === 'all' && (
                  <td className="nowrap muted">
                    {x.feeTrx ? `${fmt(x.feeTrx, 4)} trx` : '0'} · {fmt(x.energy, 0)} · {fmt(x.bandwidth, 0)}
                  </td>
                )}
                <td className={x.result === 'SUCCESS' ? 'ok' : 'error'}>{x.result.toLowerCase()}</td>
                <td>
                  <a href={explorer + x.txid} target="_blank" rel="noreferrer" className="mono">
                    {x.txid.slice(0, 8)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div className="row">
        {next && (
          <button disabled={loading} onClick={() => load(next)}>
            {loading ? 'loading…' : 'load more'}
          </button>
        )}
        {loading && !next && <span className="muted">loading…</span>}
      </div>
    </div>
  )
}
