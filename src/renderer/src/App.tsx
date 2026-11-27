import { useCallback, useEffect, useRef, useState } from 'react'
import type { Balances, NetworkId, NodeState, PublicKey, TxResult, VaultStatus } from '../../shared/types'
import { fmt, short } from './ui'
import { SendTrx, SendUsdt } from './components/Send'
import { Stake } from './components/Stake'
import { Vote } from './components/Vote'
import { Permissions } from './components/Permissions'
import { BalancesPanel } from './components/BalancesPanel'
import { NETWORK_LABELS, NodesModal } from './components/NodesModal'
import { CreateVaultModal, UnlockModal, VaultBar, VaultModal } from './components/Vault'
import { AccountActions } from './components/AccountActions'

const TABS = ['send-trx', 'send-usdt', 'stake', 'vote', 'permissions'] as const
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
  const [tab, setTab] = useState<Tab>('send-trx')
  const [log, setLog] = useState<LogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<{ label: string; resolve: (ok: boolean) => void }>()
  const [copied, setCopied] = useState<string>()
  const [nodes, setNodes] = useState<NodeState>()
  const [nodesError, setNodesError] = useState<string>()
  const [showNodes, setShowNodes] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme')
    if (saved === 'light' || saved === 'dark') return saved
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('theme', theme)
  }, [theme])
  const networkRef = useRef(network)
  networkRef.current = network

  const selected = keys.find((k) => k.id === selectedId)

  const loadKeys = useCallback(async () => {
    const res = await window.api.listKeys()
    setKeys(res.keys)
    setKeysError(res.error)
    setSelectedId((cur) => (res.keys.some((k) => k.id === cur) ? cur : res.keys[0]?.id))
    return res.keys
  }, [])

  const [vault, setVault] = useState<VaultStatus>()
  const [vaultModal, setVaultModal] = useState<'create' | 'unlock' | 'manage'>()
  const balancesRef = useRef(balances)
  balancesRef.current = balances

  /** Reload the key list and fetch balances only for addresses we have not loaded yet. */
  const syncKeys = useCallback(async () => {
    const ks = await loadKeys()
    const missing = ks.filter((k) => !balancesRef.current[k.address])
    const entries = await Promise.all(
      missing.map((k) => window.api.balances(k.address).then((b) => [k.address, b] as const).catch(() => null))
    )
    setBalances((cur) => ({ ...cur, ...Object.fromEntries(entries.filter(Boolean) as [string, Balances][]) }))
  }, [loadKeys])

  useEffect(() => {
    window.api.vaultStatus().then(setVault)
    return window.api.onVaultChanged(() => {
      window.api.vaultStatus().then(setVault)
      syncKeys()
    })
  }, [syncKeys])

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

  const activeNode = nodes?.nodes.find((n) => n.id === nodes.selected[network])

  return (
    <div className={`app ${network}`}>
      {network === 'mainnet' && <div className="mainnet-bar">mainnet: transactions are real</div>}
      <header>
        <span className="brand">tron-wallet</span>
        <nav className="seg">
          {(Object.keys(NETWORK_LABELS) as NetworkId[]).map((n) => (
            <button key={n} className={n === network ? 'on' : ''} onClick={() => switchNetwork(n)}>
              {n}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        {nodesError && <span className="error">{nodesError}</span>}
        {nodes && (
          <label className="inline">
            <span className="muted">node</span>
            <select
              value={nodes.selected[network]}
              onChange={async (e) => onNodes(await window.api.selectNode(network, e.target.value))}
            >
              {nodeOptions.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                  {n.apiKey ? ' (key)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="ghost" onClick={() => setShowNodes(true)} disabled={!nodes}>
          nodes
        </button>
        <button className="ghost" onClick={() => refresh()} disabled={loading}>
          {loading ? 'loading…' : 'refresh'}
        </button>
        <button
          className="ghost theme-toggle"
          title="Toggle light / dark theme"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        >
          {theme === 'dark' ? 'light' : 'dark'}
        </button>
      </header>

      <div className="body">
        <aside>
          <VaultBar status={vault} onOpen={setVaultModal} />
          <div className="section-title">
            addresses <span className="muted">{keys.length}</span>
          </div>
          {keysError && <div className="error pad">{keysError}</div>}
          <ul className="addr-list">
            {keys.map((k) => {
              const b = balances[k.address]
              return (
                <li
                  key={k.id}
                  className={k.id === selectedId ? 'sel' : ''}
                  onClick={() => setSelectedId(k.id)}
                >
                  <div className="addr-line">
                    <span className="addr-id">{String(k.id).padStart(2, '0')}</span>
                    <span>{short(k.address)}</span>
                    <span className={`src src-${k.source}`}>{k.source === 'file' ? 'file' : k.source}</span>
                    <button
                      className="copy"
                      onClick={(e) => {
                        e.stopPropagation()
                        copy(k.address)
                      }}
                    >
                      {copied === k.address ? 'copied' : 'copy'}
                    </button>
                  </div>
                  {k.label && <div className="addr-label">{k.label}</div>}
                  <div className="addr-bal">
                    {b ? (
                      <>
                        {fmt(b.trx, 2)} trx{b.usdt ? <> · {fmt(b.usdt, 2)} usdt</> : null}
                        {!b.activated && <> · inactive</>}
                      </>
                    ) : (
                      '…'
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </aside>

        <main>
          {selected ? (
            <>
              <BalancesPanel address={selected.address} id={selected.id} balances={bal} />
              <AccountActions
                k={selected}
                keys={keys}
                balances={bal}
                allBalances={balances}
                runTx={runTx}
                busy={busy}
              />
              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
                    {t}
                  </button>
                ))}
              </nav>
              <section className="tab-body">
                {tab === 'send-trx' && <SendTrx from={selected} {...common} />}
                {tab === 'send-usdt' && <SendUsdt from={selected} {...common} />}
                {tab === 'stake' && <Stake from={selected} balances={bal} {...common} />}
                {tab === 'vote' && <Vote from={selected} balances={bal} network={network} {...common} />}
                {tab === 'permissions' && <Permissions from={selected} network={network} {...common} />}
              </section>
            </>
          ) : (
            <div className="empty">
              {keysError ? 'Add a keys.json file to the project root, then refresh.' : 'Select an address.'}
            </div>
          )}
        </main>
      </div>

      <footer>
        <div className="section-title">
          log
          <span className="muted">
            {activeNode ? `${network} · ${activeNode.fullHost}` : network}
          </span>
        </div>
        <div className="log">
          {log.length === 0 && <div className="muted">$ no transactions yet</div>}
          {log.map((e, i) => (
            <div key={i} className="log-row">
              <span className="muted">{e.time}</span>
              <span className={`net ${e.network}`}>{e.network}</span>
              <span className="log-label">{e.label}</span>
              {e.error && <span className="error">err {e.error}</span>}
              {e.result && (
                <>
                  <span className={e.result.ok ? 'ok' : 'error'}>{e.result.ok ? 'ok' : `err ${e.result.message}`}</span>
                  {e.url && (
                    <a href={e.url} target="_blank" rel="noreferrer">
                      {short(e.result.txid)}
                    </a>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </footer>

      {vaultModal === 'create' && vault && (
        <CreateVaultModal path={vault.path} onClose={() => setVaultModal(undefined)} />
      )}
      {vaultModal === 'unlock' && <UnlockModal onClose={() => setVaultModal(undefined)} />}
      {vaultModal === 'manage' && vault?.unlocked && (
        <VaultModal
          status={vault}
          onClose={() => setVaultModal(undefined)}
          onCreated={(ks) => ks[0] && setSelectedId(ks[ks.length - 1].id)}
        />
      )}

      {showNodes && nodes && (
        <NodesModal state={nodes} network={network} onState={onNodes} onClose={() => setShowNodes(false)} />
      )}

      {confirm && (
        <div className="modal-backdrop">
          <div className="modal confirm">
            <div className="modal-head danger-head">confirm mainnet transaction</div>
            <div className="modal-body">
              <p>This broadcasts a real transaction on mainnet:</p>
              <pre>{confirm.label}</pre>
              <div className="actions">
                <button
                  className="ghost"
                  onClick={() => {
                    confirm.resolve(false)
                    setConfirm(undefined)
                  }}
                >
                  cancel
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    confirm.resolve(true)
                    setConfirm(undefined)
                  }}
                >
                  confirm and send
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
