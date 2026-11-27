import { useCallback, useEffect, useRef, useState } from 'react'
import type { AccountPermissions, Balances, LiveActivity, LiveStatus, NetworkId, NodeConfig, NodeState, PublicKey, TxReceipt, TxResult, VaultStatus } from '../../shared/types'
import { TxContext, fmt, short } from './ui'
import { SendTrx, SendUsdt } from './components/Send'
import { Stake } from './components/Stake'
import { Vote } from './components/Vote'
import { Delegate } from './components/Delegate'
import { Permissions } from './components/Permissions'
import { BalancesPanel } from './components/BalancesPanel'
import { NETWORK_LABELS, NodesModal } from './components/NodesModal'
import { CreateVaultModal, UnlockModal, VaultBar, VaultModal } from './components/Vault'
import { AccountActions } from './components/AccountActions'
import { SignTx, type PendingEntry } from './components/SignTx'
import { History } from './components/History'

const TABS = ['send-trx', 'send-usdt', 'stake', 'delegate', 'vote', 'permissions', 'sign-tx', 'history'] as const
type Tab = (typeof TABS)[number]

interface LogEntry {
  time: string
  network: NetworkId
  label: string
  result?: TxResult
  error?: string
  url?: string
  /** filled in once the tx is found in a block */
  receipt?: TxReceipt
  /** seen in a new block by live mode */
  live?: LiveActivity
}

/** Runs a tx action with mainnet confirmation and logging. Resolves to the result, or undefined if cancelled/failed. */
/** Mainnet TronGrid with no saved key and no env key: heavily rate limited. */
const isKeylessPublicGrid = (n: NodeConfig, envKey?: boolean) =>
  n.network === 'mainnet' &&
  /(^|\.)trongrid\.io$/.test(new URL(n.fullHost.replace('{key}', 'k')).hostname) &&
  !n.apiKey &&
  !(n.builtin && envKey)

export type RunTx = (label: string, fn: () => Promise<TxResult>) => Promise<TxResult | undefined>

export default function App() {
  const [network, setNetwork] = useState<NetworkId>('shasta')
  const [keys, setKeys] = useState<PublicKey[]>([])
  const [keysError, setKeysError] = useState<string>()
  const keysRef = useRef<PublicKey[]>([])
  const [selectedId, setSelectedId] = useState<number>()
  const [balances, setBalances] = useState<Record<string, Balances>>({})
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>('send-trx')
  const [log, setLog] = useState<LogEntry[]>([])
  const [pending, setPending] = useState<PendingEntry[]>([])
  const [signJson, setSignJson] = useState('')
  const [memoFee, setMemoFee] = useState(0)
  const [perms, setPerms] = useState<AccountPermissions>()
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
  // ---- live mode: follow new blocks, react to txs touching our addresses ----
  const [liveOn, setLiveOn] = useState(() => localStorage.getItem('live') === 'on')
  const [liveStatus, setLiveStatus] = useState<LiveStatus>()
  const [flash, setFlash] = useState<Set<string>>(new Set())
  useEffect(() => localStorage.setItem('live', liveOn ? 'on' : 'off'), [liveOn])
  const networkRef = useRef(network)
  networkRef.current = network

  const selected = keys.find((k) => k.id === selectedId)

  const loadKeys = useCallback(async () => {
    const res = await window.api.listKeys()
    setKeys(res.keys)
    keysRef.current = res.keys
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

  const [balanceErrors, setBalanceErrors] = useState<Record<string, string>>({})

  /** Load balances for all keys. Each result is shown as soon as it arrives; failures are kept per address. */
  const refresh = useCallback(async (list?: PublicKey[]) => {
    const ks = list ?? (await loadKeys())
    setLoading(true)
    setBalanceErrors({})
    await Promise.all(
      ks.map((k) =>
        window.api
          .balances(k.address)
          .then((b) => setBalances((cur) => ({ ...cur, [k.address]: b })))
          .catch((e) => setBalanceErrors((cur) => ({ ...cur, [k.address]: e.message })))
      )
    )
    setLoading(false)
  }, [loadKeys])

  /** Refresh one address's balance (live hits) without touching the others. */
  const refreshOne = useCallback((address: string) => {
    window.api
      .balances(address)
      .then((b) => setBalances((cur) => ({ ...cur, [address]: b })))
      .catch(() => {})
  }, [])

  const addressKey = keys.map((k) => k.address).join(',')
  useEffect(() => {
    window.api.liveSet(liveOn, keys.map((k) => k.address)).then(setLiveStatus)
  }, [liveOn, addressKey])

  useEffect(() => {
    const offStatus = window.api.onLiveStatus(setLiveStatus)
    const offGap = window.api.onLiveGap(() => refresh(keysRef.current))
    const offHits = window.api.onLiveActivity(async (hits) => {
      const mine = hits.filter((h) => h.network === networkRef.current)
      if (!mine.length) return
      const time = new Date().toLocaleTimeString('en-GB')
      const urls = await Promise.all(mine.map((h) => window.api.explorerUrl(h.txid)))
      setLog((l) => {
        // our own sends are already in the log (from runTx); don't repeat them
        const known = new Set(l.map((e) => e.result?.txid).filter(Boolean))
        const fresh = mine
          .map((h, i) => ({ time, network: h.network, label: '', live: h, url: urls[i] }))
          .filter((e) => !known.has(e.live.txid))
        return [...fresh, ...l].slice(0, 300)
      })
      const touched = [...new Set(mine.map((h) => h.address))]
      touched.forEach((a) => refreshOne(a))
      setFlash(new Set(touched))
      setTimeout(() => setFlash(new Set()), 2500)
    })
    return () => {
      offStatus()
      offGap()
      offHits()
    }
  }, [refresh, refreshOne])

  // things a block scan can't see (transfers inside other contracts): full refresh every 2 min while live
  useEffect(() => {
    if (!liveOn) return
    const t = setInterval(() => refresh(keysRef.current), 120_000)
    return () => clearInterval(t)
  }, [liveOn, refresh])

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
    if (networkRef.current === 'mainnet' && !(await askConfirm(label))) return undefined
    setBusy(true)
    const time = new Date().toLocaleTimeString('en-GB')
    const net = networkRef.current
    try {
      const result = await fn()
      if (result.pending) {
        // signed but below threshold: keep it for the sign-tx tab
        const p = result.pending
        setPending((list) => [{ txid: p.txid, label, json: p.json, network: net }, ...list.filter((x) => x.txid !== p.txid)])
        setLog((l) => [{ time, network: net, label, result }, ...l])
        return result
      }
      const url = result.txid ? await window.api.explorerUrl(result.txid) : undefined
      setLog((l) => [{ time, network: net, label, result, url }, ...l])
      if (result.ok) pollReceipt(result.txid)
      // give the node a moment to include the tx before refreshing
      setTimeout(() => refresh(keys), 3500)
      return result
    } catch (e: any) {
      setLog((l) => [{ time, network: net, label, error: e.message }, ...l])
      return undefined
    } finally {
      setBusy(false)
    }
  }

  /** Poll for the mined receipt (real fee / energy / result) for up to ~30 s. */
  const pollReceipt = (txid: string) => {
    let tries = 0
    const tick = async () => {
      tries++
      const r = await window.api.txReceipt(txid).catch(() => undefined)
      if (r?.found) {
        setLog((l) => l.map((e) => (e.result?.txid === txid ? { ...e, receipt: r } : e)))
        return
      }
      if (tries < 10) setTimeout(tick, 3000)
    }
    setTimeout(tick, 3000)
  }

  const openPending = (json: string) => {
    setSignJson(json)
    setTab('sign-tx')
  }

  useEffect(() => {
    window.api.getMemoFee().then(setMemoFee).catch(() => setMemoFee(0))
  }, [network])

  // on-chain permissions of the selected account (who can sign for it); reloaded after txs via balances
  const selectedBalance = selected ? balances[selected.address] : undefined
  useEffect(() => {
    setPerms(undefined)
    if (!selected) return
    let alive = true
    window.api
      .getPermissions(selected.address)
      .then((p) => alive && setPerms(p))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [selected?.address, network, selectedBalance])

  const copy = (addr: string) => {
    navigator.clipboard.writeText(addr)
    setCopied(addr)
    setTimeout(() => setCopied(undefined), 1200)
  }

  const bal = selected ? balances[selected.address] : undefined
  const common = { keys, runTx, busy }

  const activeNode = nodes?.nodes.find((n) => n.id === nodes.selected[network])

  return (
    <TxContext.Provider value={{ keys, from: selected, memoFee, perms }}>
    <div className={`app ${network}`}>
      {network === 'mainnet' && <div className="mainnet-bar">mainnet: transactions are real</div>}
      {activeNode && isKeylessPublicGrid(activeNode, nodes?.envKey) && (
        <div className="notice-bar">
          Public TronGrid without an API key allows ~3 requests/s, so requests are queued and loading is slow.{' '}
          <button className="link" onClick={() => setShowNodes(true)}>
            Add a free key from trongrid.io in nodes
          </button>
        </div>
      )}
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
        <button
          className={`ghost live-toggle ${liveOn ? 'on' : ''} ${liveOn && liveStatus && !liveStatus.ok ? 'bad' : ''}`}
          title={
            liveOn
              ? liveStatus?.ok === false
                ? `live: last block request failed (${liveStatus.error}), retrying`
                : 'live: following new blocks (~3 s) for your addresses. Click to turn off.'
              : 'Follow new blocks and update balances, log and history as your addresses are used'
          }
          onClick={() => setLiveOn((v) => !v)}
        >
          <span key={liveStatus?.block} className="live-dot" />
          {liveOn ? (liveStatus?.block ? `#${liveStatus.block.toLocaleString('en-US')}` : 'live…') : 'live'}
        </button>
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
                  className={`${k.id === selectedId ? 'sel' : ''} ${flash.has(k.address) ? 'flash' : ''}`}
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
                    ) : balanceErrors[k.address] ? (
                      <span className="error" title={balanceErrors[k.address]}>
                        failed to load
                      </span>
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
              <BalancesPanel
                address={selected.address}
                id={selected.id}
                balances={bal}
                error={bal ? undefined : balanceErrors[selected.address]}
                onRetry={() => refresh(keys)}
              />
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
                {tab === 'delegate' && (
                  <Delegate from={selected} balances={bal} network={network} {...common} />
                )}
                {tab === 'vote' && <Vote from={selected} balances={bal} network={network} {...common} />}
                {tab === 'sign-tx' && (
                  <SignTx
                    keys={keys}
                    network={network}
                    pending={pending}
                    json={signJson}
                    setJson={setSignJson}
                    onUpdated={(txid, json) =>
                      setPending((list) => list.map((p) => (p.txid === txid ? { ...p, json } : p)))
                    }
                    onDone={(txid) => setPending((list) => list.filter((p) => p.txid !== txid))}
                    runTx={runTx}
                    busy={busy}
                  />
                )}
                {tab === 'history' && <History from={selected} keys={keys} network={network} balances={bal} />}
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
              {e.live && <LiveLine h={e.live} url={e.url} keys={keys} />}
              {!e.live && <span className="log-label">{e.label}</span>}
              {e.error && <span className="error">err {e.error}</span>}
              {e.result?.pending && (
                <>
                  <span className="warn">
                    pending {e.result.pending.weight}/{e.result.pending.threshold}
                  </span>
                  <button className="link" onClick={() => openPending(e.result!.pending!.json)}>
                    open in sign-tx
                  </button>
                </>
              )}
              {e.result && !e.result.pending && (
                <>
                  {!e.result.ok && <span className="error">err {e.result.message}</span>}
                  {e.result.ok && !e.receipt && <span className="ok">sent · confirming…</span>}
                  {e.receipt && e.receipt.result === 'SUCCESS' && (
                    <span className="ok">
                      confirmed
                      <span className="muted">
                        {' '}
                        · fee {fmt(e.receipt.feeTrx ?? 0, 4)} trx · energy {fmt(e.receipt.energy ?? 0, 0)} · bw{' '}
                        {fmt(e.receipt.bandwidth ?? 0, 0)}
                      </span>
                    </span>
                  )}
                  {e.receipt && e.receipt.result !== 'SUCCESS' && (
                    <span className="error">
                      failed: {e.receipt.result?.toLowerCase()} · fee {fmt(e.receipt.feeTrx ?? 0, 4)} trx
                    </span>
                  )}
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
    </TxContext.Provider>
  )
}

/** One log line for a tx seen by live mode. */
function LiveLine({ h, url, keys }: { h: LiveActivity; url?: string; keys: PublicKey[] }) {
  const k = keys.find((x) => x.address === h.address)
  const other = h.counterparty ? keys.find((x) => x.address === h.counterparty) : undefined
  const verb = h.type === 'Transfer' || h.unit === 'usdt' ? (h.direction === 'in' ? 'received' : 'sent') : h.type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return (
    <>
      <span className="live-tag">live</span>
      <span className="log-label">
        {k ? `#${k.id}` : short(h.address)} {h.direction === 'in' ? '←' : '→'} {verb}
        {h.amount !== undefined && (
          <span className={h.direction === 'in' ? 'ok' : ''}>
            {' '}
            {h.direction === 'in' ? '+' : '−'}
            {fmt(h.amount, 6)} {h.unit}
          </span>
        )}
        {h.counterparty && (
          <span className="muted">
            {' '}
            {h.direction === 'in' ? 'from' : 'to'} {other ? `#${other.id}` : short(h.counterparty)}
          </span>
        )}
      </span>
      <span className="muted">block {h.block.toLocaleString('en-US')}</span>
      {h.result && h.result !== 'SUCCESS' && <span className="error">{h.result.toLowerCase()}</span>}
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          {short(h.txid)}
        </a>
      )}
    </>
  )
}
