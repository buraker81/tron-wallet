import { useCallback, useEffect, useRef, useState } from 'react'
import type { Balances, NetworkId, NodeState, PublicKey, TxResult } from '../../shared/types'
import { fmt, short } from './ui'
import { SendTrx, SendUsdt } from './components/Send'
import { Stake } from './components/Stake'
import { Vote } from './components/Vote'
import { Permissions } from './components/Permissions'
import { BalancesPanel } from './components/BalancesPanel'
import { NETWORK_LABELS, NodesModal } from './components/NodesModal'

const TABS = ['Send TRX', 'Send USDT', 'Stake', 'Vote', 'Permissions'] as const
type Tab = (typeof TABS)[number]

interface LogEntry {
  time: string
  network: NetworkId
  label: string
  result?: TxResult
  error?: string
  url?: string
}

export type RunTx = (label: string, fn: () => Promise<TxResult>) => Promise<void>

export default function App() {
  const [network, setNetwork] = useState<NetworkId>('shasta')
  const [keys, setKeys] = useState<PublicKey[]>([])
  const [keysError, setKeysError] = useState<string>()
  const [selectedId, setSelectedId] = useState<number>()
  const [balances, setBalances] = useState<Record<string, Balances>>({})
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('Send TRX')
  const [log, setLog] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ label: string; resolve: (ok: boolean) => void }>()
  const [copied, setCopied] = useState<string>()
  const [nodes, setNodes] = useState<NodeState>()
  const [nodesError, setNodesError] = useState<string>()
  const [showNodes, setShowNodes] = useState(false)
  const networkRef = useRef(network)
  networkRef.current = network

  const selected = keys.find((k) => k.id === selectedId)

  const loadKeys = useCallback(async () => {
    const res = await window.api.listKeys()
    setKeys(res.keys)
    setKeysError(res.error)
    setSelectedId((cur) => cur ?? res.keys[0]?.id)
    return res.keys
  }, [])

  const refresh = useCallback(async (list?: PublicKey[]) => {
    const ks = list ?? (await loadKeys())
    setLoading(true)
    const entries = await Promise.all(
      ks.map((k) =>
        window.api
          .balances(k.address)
          .then((b) => [k.address, b] as const)
          .catch(() => null)
      )
    )
    setBalances(Object.fromEntries(entries.filter(Boolean) as [string, Balances][]))
    setLoading(false)
  }, [loadKeys])

  useEffect(() => {
    window.api.getNetwork().then(setNetwork)
    window.api.listNodes().then(setNodes).catch((e) => setNodesError(e.message))
    loadKeys().then(refresh)
  }, [loadKeys, refresh])

  const switchNetwork = async (n: NetworkId) => {
    await window.api.setNetwork(n)
    setNetwork(n)
    setBalances({})
    refresh(keys)
  }

  const onNodes = (s: NodeState) => {
    const changed = nodes?.selected[network] !== s.selected[network]
    setNodes(s)
    if (changed) {
      setBalances({})
      refresh(keys)
    }
  }

  const nodeOptions = nodes?.nodes.filter((n) => n.network === network) ?? []

  const askConfirm = (label: string) =>
    new Promise<boolean>((resolve) => setConfirm({ label, resolve }))

  const runTx: RunTx = async (label, fn) => {
    if (networkRef.current === 'mainnet' && !(await askConfirm(label))) return
    setBusy(true)
    const time = new Date().toLocaleTimeString('en-GB')
    const net = networkRef.current
    try {
      const result = await fn()
      const url = result.txid ? await window.api.explorerUrl(result.txid) : undefined
      setLog((l) => [{ time, network: net, label, result, url }, ...l])
      // give the node a moment to include the tx before refreshing
      setTimeout(() => refresh(keys), 3500)
    } catch (e: any) {
      setLog((l) => [{ time, network: net, label, error: e.message }, ...l])
    } finally {
      setBusy(false)
    }
  }

  const copy = (addr: string) => {
    navigator.clipboard.writeText(addr)
    setCopied(addr)
    setTimeout(() => setCopied(undefined), 1200)
  }

  const bal = selected ? balances[selected.address] : undefined
  const common = { keys, runTx, busy }

  return (
    <div className={`app ${network}`}>
      <header>
        <h1>Tron Wallet</h1>
        {network === 'mainnet' && <span className="badge-mainnet">MAINNET</span>}
        <div className="spacer" />
        <div className="net-toggle">
          {(Object.keys(NETWORK_LABELS) as NetworkId[]).map((n) => (
            <button key={n} className={n === network ? 'active' : ''} onClick={() => switchNetwork(n)}>
              {NETWORK_LABELS[n]}
            </button>
          ))}
        </div>
        {nodesError && <span className="error small">{nodesError}</span>}
        {nodes && (
          <select
            title="Active node"
            value={nodes.selected[network]}
            onChange={async (e) => onNodes(await window.api.selectNode(network, e.target.value))}
          >
            {nodeOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.apiKey ? ' 🔑' : ''}
              </option>
            ))}
          </select>
        )}
        <button onClick={() => setShowNodes(true)} disabled={!nodes}>
          Nodes
        </button>
        <button onClick={() => refresh()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </header>

      <div className="body">
        <aside>
          <div className="aside-title">Addresses ({keys.length})</div>
          {keysError && <div className="error small">{keysError}</div>}
          {keys.map((k) => (
            <div
              key={k.id}
              className={`addr-item ${k.id === selectedId ? 'selected' : ''}`}
              onClick={() => setSelectedId(k.id)}
            >
              <div className="addr-row">
                <span className="addr-id">#{k.id}</span>
                <span className="mono">{short(k.address)}</span>
                <button
                  className="link"
                  onClick={(e) => {
                    e.stopPropagation()
                    copy(k.address)
                  }}
                >
                  {copied === k.address ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="addr-bal">
                {balances[k.address]
                  ? `${fmt(balances[k.address].trx, 2)} TRX${
                      balances[k.address].usdt ? ` · ${fmt(balances[k.address].usdt!, 2)} USDT` : ''
                    }`
                  : '—'}
              </div>
            </div>
          ))}
        </aside>

        <main>
          {selected ? (
            <>
              <BalancesPanel address={selected.address} id={selected.id} balances={bal} />
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </nav>
              <section className="tab-body">
                {tab === 'Send TRX' && <SendTrx from={selected} {...common} />}
                {tab === 'Send USDT' && <SendUsdt from={selected} {...common} />}
                {tab === 'Stake' && <Stake from={selected} balances={bal} {...common} />}
                {tab === 'Vote' && <Vote from={selected} balances={bal} network={network} {...common} />}
                {tab === 'Permissions' && <Permissions from={selected} network={network} {...common} />}
              </section>
            </>
          ) : (
            <div className="empty">
              {keysError ? 'Add a keys.json file to the project root, then hit Refresh.' : 'Select an address.'}
            </div>
          )}
        </main>
      </div>

      <footer>
        <div className="aside-title">Transaction log</div>
        {log.length === 0 && <div className="muted small">No transactions yet.</div>}
        {log.map((e, i) => (
          <div key={i} className="log-row">
            <span className="muted">{e.time}</span>
            <span className={`net-tag ${e.network}`}>{e.network}</span>
            <span>{e.label}</span>
            {e.error && <span className="error">{e.error}</span>}
            {e.result && (
              <>
                <span className={e.result.ok ? 'ok' : 'error'}>
                  {e.result.ok ? 'Broadcast OK' : e.result.message}
                </span>
                {e.url && (
                  <a href={e.url} target="_blank" rel="noreferrer" className="mono">
                    {short(e.result.txid)}
                  </a>
                )}
              </>
            )}
          </div>
        ))}
      </footer>

      {showNodes && nodes && (
        <NodesModal state={nodes} network={network} onState={onNodes} onClose={() => setShowNodes(false)} />
      )}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal">
            <h3>You are on MAINNET</h3>
            <p>This will broadcast a real transaction:</p>
            <p className="mono">{confirm.label}</p>
            <div className="row">
              <button
                onClick={() => {
                  confirm.resolve(false)
                  setConfirm(undefined)
                }}
              >
                Cancel
              </button>
              <button
                className="danger"
                onClick={() => {
                  confirm.resolve(true)
                  setConfirm(undefined)
                }}
              >
                Confirm & Send
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
