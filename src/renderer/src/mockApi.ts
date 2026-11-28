// Dev-only fake API for previewing the UI in a browser. Never used inside Electron.
import type { Balances, MnemonicInfo, NetworkId, NodeState, PublicKey, VaultStatus } from '../../shared/types'
import { DEFAULT_OPS } from '../../shared/operations'
import { applyFilters, dayKey, dayList, feeBuckets, inRange, kindCounts, mergeFeeds, totals, usdtSeries } from '../../shared/historyData'

const fileKeys: PublicKey[] = [
  { id: 1, address: 'TXyZjVcYurrbE43b2MfMtN34uA3tJL85zy', source: 'file', canSign: true },
  { id: 2, address: 'TUjAyePMcSGPyeCcsNRjTLxZkYMTF9UyAA', source: 'file', canSign: true }
]
let vaultKeys: PublicKey[] = [
  { id: 3, address: 'TT2RHcg9JRU3LFx8sPukc9UizBYF8D44U2', source: 'hd', canSign: true, label: 'multisig/0', hd: { mnemonicId: 'm1', index: 0, path: "m/44'/195'/0'/0/0" } },
  { id: 4, address: 'TQpzvGQ9Xzn2UfVTn9uvBRV9riqSjvZ1U7', source: 'hd', canSign: true, label: 'multisig/1', hd: { mnemonicId: 'm1', index: 1, path: "m/44'/195'/0'/0/1" } },
  { id: 5, address: 'TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp', source: 'watch', canSign: false, label: 'co-signer' }
]
let vault: VaultStatus = { exists: true, unlocked: false, path: '/Users/you/projects/tron_wallet/vault.json', autoLockMinutes: 15 }
let seeds: MnemonicInfo[] = [{ id: 'm1', name: 'multisig', words: 12, hasPassphrase: false, nextIndex: 2, derived: 2, createdAt: Date.now() }]
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => setTimeout(l, 0))
const randAddr = () => 'T' + Array.from({ length: 33 }, () => '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 58)]).join('')
const PHRASE = 'abandon ability able about above absent absorb abstract absurd abuse access accident'
const keys = () => [...fileKeys, ...(vault.unlocked ? vaultKeys : [])]
const nextId = () => Math.max(...fileKeys.map((k) => k.id), ...vaultKeys.map((k) => k.id)) + 1
const addVaultKey = (k: Omit<PublicKey, 'id'>) => {
  const key = { ...k, id: nextId() }
  vaultKeys = [...vaultKeys, key]
  changed()
  return key
}

const bal = (address: string, trx: number, usdt: number, active = true): Balances => ({
  address,
  activated: active,
  trx,
  usdt,
  energy: { used: 1200, limit: trx > 1000 ? 52000 : 0 },
  bandwidth: { used: 210, limit: 600 },
  frozen: trx > 1000 ? [{ type: 'ENERGY', amount: 2000 }, { type: 'BANDWIDTH', amount: 500 }] : [],
  unfreezing: trx > 1000 ? [{ amount: 100, expireAt: Date.now() + 86400e3 * 3 }] : [],
  tronPower: trx > 1000 ? 2500 : 0,
  votes: trx > 1000 ? [{ address: 'TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp', count: 1500 }] : [],
  delegatedOut: trx > 1000 ? { energy: 500, bandwidth: 0 } : { energy: 0, bandwidth: 0 },
  delegatedIn: trx === 12 ? { energy: 500, bandwidth: 0 } : { energy: 0, bandwidth: 0 }
})

const balances: Record<string, Balances> = {
  [fileKeys[0].address]: bal(fileKeys[0].address, 4821.553, 129.5),
  [fileKeys[1].address]: bal(fileKeys[1].address, 98.2, 0),
  [vaultKeys[0].address]: bal(vaultKeys[0].address, 12, 0),
  [vaultKeys[1].address]: bal(vaultKeys[1].address, 0, 0, false),
  [vaultKeys[2].address]: bal(vaultKeys[2].address, 310.4, 25)
}

let network: NetworkId = 'shasta'
let nodes: NodeState = {
  path: '/Users/you/projects/tron_wallet/nodes.json',
  envKey: false,
  selected: { shasta: 'trongrid-shasta', nile: 'trongrid-nile', mainnet: 'trongrid-mainnet' },
  nodes: [
    { id: 'trongrid-shasta', name: 'TronGrid Shasta', network: 'shasta', fullHost: 'https://api.shasta.trongrid.io', apiKey: 'a1b2c3d4-0000-1111-2222-333344445555', builtin: true },
    { id: 'local', name: 'local java-tron', network: 'shasta', fullHost: 'http://127.0.0.1:8090', apiKey: '' },
    { id: 'trongrid-nile', name: 'TronGrid Nile', network: 'nile', fullHost: 'https://nile.trongrid.io', apiKey: '', builtin: true },
    { id: 'trongrid-mainnet', name: 'TronGrid Mainnet', network: 'mainnet', fullHost: 'https://api.trongrid.io', apiKey: '', builtin: true }
  ]
}

const wait = <T>(v: T, ms = 150) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const mockMultisig = (opts?: any) => {
  const txid = Math.random().toString(16).slice(2).padEnd(64, 'b')
  const json = JSON.stringify({ mock: true, txid, signed: [fileKeys[0].address], note: opts?.note, exp: Date.now() + 3600e3 })
  return wait({ txid, ok: false, message: 'signed 1/2, needs more signatures', pending: { json, txid, weight: 1, threshold: 2 } }, 400)
}
const summarize = (json: string) => {
  const m = JSON.parse(json)
  if (!m.mock) throw new Error('raw_data does not match raw_data_hex / txID (tampered or corrupted transaction)')
  const permKeys = [fileKeys[0].address, vaultKeys[0].address, 'TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp']
  return {
    txid: m.txid, network, owner: fileKeys[0].address, contractType: 'TransferContract',
    params: [['to address', fileKeys[1].address], ['amount', '25 trx']], permissionId: 2, permissionName: 'treasury',
    note: m.note, expiration: m.exp, expired: false, signatures: m.signed.length, approved: m.signed,
    weight: m.signed.length, threshold: 2, keys: permKeys.map((address) => ({ address, weight: 1 })),
    status: m.signed.length >= 2 ? 'ENOUGH_PERMISSION' : 'NOT_ENOUGH_PERMISSION'
  }
}
const tx = (...args: any[]) => (args[args.length - 1]?.signers ? mockMultisig(args[args.length - 1]) : plainTx())
const plainTx = () => wait({ txid: Math.random().toString(16).slice(2).padEnd(64, 'a'), ok: Math.random() > 0.3, message: 'CONTRACT_VALIDATE_ERROR: balance is not sufficient' }, 400)


// ---- mock history: ~140 txs over ~100 days, deterministic ----
const ME = 'TXyZjVcYurrbE43b2MfMtN34uA3tJL85zy'
const USDT = 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs'
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const base = (over: Record<string, unknown>) => ({
  txid: Math.floor(rnd() * 1e16).toString(16).padStart(16, '0').repeat(4),
  direction: 'out', sign: 0, result: 'SUCCESS', paidByMe: true,
  feeTrx: 0, energy: 0, bandwidth: 267, ...over,
  fees: { bandwidth: 0, energy: 0, activation: 0, memo: 0, multisig: 0, permission: 0, other: 0, ...((over.fees as object) ?? {}) }
})
const others = ['TUjAyePMcSGPyeCcsNRjTLxZkYMTF9UyAA', 'TT2RHcg9JRU3LFx8sPukc9UizBYF8D44U2', 'TGNzrfuE14gMxBNwNVdzwFaMLHbm16rrKd']
const mockAll: any[] = []
const mockTrc20: any[] = []
for (let i = 0; i < 140; i++) {
  const time = Date.now() - Math.floor(rnd() * 100 * 864e5)
  const r = rnd()
  const cp = others[Math.floor(rnd() * 3)]
  if (r < 0.35) {
    const out = rnd() < 0.55
    const v = Math.round(rnd() * 400 * 100) / 100
    const burn = out && rnd() < 0.3 ? 0.267 : 0
    const activate = out && rnd() < 0.15
    const memo = out && rnd() < 0.12
    const fee = burn + (activate ? 1.1 : 0) + (memo ? 1 : 0)
    mockAll.push(base({ time, type: 'Transfer', kind: activate ? 'account-create' : 'transfer', createdAccount: activate, direction: out ? 'out' : 'in', sign: out ? -1 : 1, value: v, unit: 'trx', amount: v + ' trx', counterparty: cp, paidByMe: out, feeTrx: fee, note: memo ? 'invoice ' + i : undefined, fees: { bandwidth: activate ? 0 : burn, activation: activate ? 1.1 : 0, memo: memo ? 1 : 0 } }))
  } else if (r < 0.6) {
    const out = rnd() < 0.5
    const v = Math.round(rnd() * 120 * 100) / 100
    const txid = Math.floor(rnd() * 1e16).toString(16).padStart(16, '0').repeat(4)
    const t20 = base({ txid, time, type: 'USDT transfer', kind: 'trc20', direction: out ? 'out' : 'in', sign: out ? -1 : 1, value: v, unit: 'usdt', amount: v + ' usdt', counterparty: cp, paidByMe: out, isUsdt: true, tokenContract: USDT, bandwidth: 0 })
    mockTrc20.push(t20)
    if (out) {
      const fail = rnd() < 0.06
      const ef = Math.round((fail ? 6.2 : rnd() < 0.5 ? 1.3 + rnd() * 2 : 0) * 1e4) / 1e4
      mockAll.push(base({ txid, time, type: 'TriggerSmart', kind: 'contract-call', counterparty: USDT, amount: 'token transfer', feeTrx: ef, fees: { energy: ef }, energy: fail ? 62000 : 13045 + Math.floor(rnd() * 20000), bandwidth: 345, result: fail ? 'OUT_OF_ENERGY' : 'SUCCESS' }))
      if (fail) mockTrc20.pop()
    }
  } else if (r < 0.7) {
    mockAll.push(base({ time, type: rnd() < 0.7 ? 'FreezeBalanceV2' : 'UnfreezeBalanceV2', kind: 'stake', value: 100 * Math.ceil(rnd() * 10), unit: 'trx', amount: 'stake' }))
  } else if (r < 0.78) {
    mockAll.push(base({ time, type: 'VoteWitness', kind: 'vote', value: 1500, unit: 'votes', amount: '1500 votes' }))
  } else if (r < 0.84) {
    const v = 100 * Math.ceil(rnd() * 5)
    const un = rnd() < 0.35
    mockAll.push(base({ time, type: un ? 'UnDelegateResource' : 'DelegateResource', kind: un ? 'undelegate' : 'delegate', value: v, unit: 'trx', amount: v + ' trx energy', counterparty: cp }))
  } else if (r < 0.88) {
    mockAll.push(base({ time, type: 'WithdrawBalance', kind: 'claim', amount: 'claim' }))
  } else if (r < 0.9) {
    mockAll.push(base({ time, type: 'AccountPermissionUpdate', kind: 'permission', feeTrx: 101, signature: 2, fees: { permission: 100, multisig: 1 }, bandwidth: 366 }))
  } else if (r < 0.93) {
    mockTrc20.push(base({ time, type: 'USDT transfer', kind: 'trc20', direction: 'in', sign: 1, value: 0.001, unit: 'usdt', amount: '0.001 usdt', counterparty: 'TPhishy1111111111111111111111111bb', paidByMe: false, isUsdt: false, tokenContract: 'TFakeUSDTcontract111111111111111aa', bandwidth: 0 }))
  } else {
    mockAll.push(base({ time, type: 'VoteWitness', kind: 'vote', direction: 'in', counterparty: cp, paidByMe: false, value: 20, unit: 'votes', amount: '20 votes' }))
  }
}
for (const x of mockAll) if (x.type === 'UnfreezeBalanceV2') x.kind = 'unstake'
mockAll.sort((a, b) => b.time - a.time)
mockTrc20.sort((a, b) => b.time - a.time)
// daily TRX balance for ~1000 days ending at the current mock balance
const mockDaily: { day: string; trx: number }[] = []
{
  let bal = 4821.553
  for (let i = 0; i < 1000; i++) {
    mockDaily.unshift({ day: new Date(Date.now() - i * 864e5).toISOString().slice(0, 10), trx: Math.round(bal * 1e6) / 1e6 })
    bal = Math.max(0, bal - (rnd() - 0.45) * 60)
  }
}
void ME

let liveTimer: any
let liveOn = false
let liveBlock = 70490000
const liveListeners = { status: new Set<(s: any) => void>(), activity: new Set<(h: any[]) => void>() }
function liveTick() {
  if (!liveOn) return
  liveBlock++
  liveListeners.status.forEach((cb) => cb({ enabled: true, ok: true, block: liveBlock, network }))
  if (liveBlock % 3 === 0) {
    const inbound = liveBlock % 2 === 0
    const usdt = liveBlock % 9 === 0
    const hit = {
      network, block: liveBlock, time: Date.now(), txid: Math.random().toString(16).slice(2).padEnd(64, 'c'),
      type: usdt ? 'TriggerSmart' : 'Transfer', address: fileKeys[inbound ? 1 : 0].address, direction: inbound ? 'in' : 'out',
      counterparty: inbound ? fileKeys[0].address : 'TGNzrfuE14gMxBNwNVdzwFaMLHbm16rrKd', amount: usdt ? 25 : 12.5, unit: usdt ? 'usdt' : 'trx', result: 'SUCCESS'
    }
    liveListeners.activity.forEach((cb) => cb([hit]))
  }
}

export function installMockApi() {
  ;(window as any).api = {
    listKeys: () => wait({ keys: keys(), path: '/Users/you/projects/tron_wallet/keys.json' }),
    onVaultChanged: (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb)),
    vaultStatus: () => wait(vault),
    vaultCreate: () => wait((vault = { ...vault, exists: true, unlocked: true }), 300).then((v) => (changed(), v)),
    vaultUnlock: (pw: string) =>
      pw === 'wrong' ? Promise.reject(new Error('Wrong password')) : wait((vault = { ...vault, unlocked: true }), 300).then((v) => (changed(), v)),
    vaultLock: () => wait((vault = { ...vault, unlocked: false })).then((v) => (changed(), v)),
    vaultChangePassword: () => wait(vault),
    listMnemonics: () => wait(seeds),
    createMnemonic: (name: string, words: number) => {
      seeds = [...seeds, { id: 'm' + Date.now(), name: name || 'seed', words, hasPassphrase: false, nextIndex: 0, derived: 0, createdAt: Date.now() }]
      return wait({ id: 'x', phrase: words === 24 ? `${PHRASE} ${PHRASE}` : PHRASE })
    },
    importMnemonic: () => wait(seeds),
    deriveNext: (id: string, n: number) => {
      const s = seeds.find((x) => x.id === id)!
      const out = Array.from({ length: n }, () => {
        const i = s.nextIndex++
        s.derived++
        return addVaultKey({ address: randAddr(), source: 'hd', canSign: true, label: `${s.name}/${i}`, hd: { mnemonicId: id, index: i, path: `m/44'/195'/0'/0/${i}` } })
      })
      seeds = [...seeds]
      return wait(out)
    },
    createRandomKey: (label: string) => wait(addVaultKey({ address: randAddr(), source: 'random', canSign: true, label: label || 'random' })),
    importPrivateKey: (label: string) => wait(addVaultKey({ address: randAddr(), source: 'imported', canSign: true, label: label || 'imported' })),
    addWatchOnly: (label: string, address: string) => wait(addVaultKey({ address, source: 'watch', canSign: false, label: label || 'watch' })),
    importKeysFile: () => wait({ added: 0, skipped: 2 }),
    renameKey: (id: number, label: string) => wait((vaultKeys = vaultKeys.map((k) => (k.id === id ? { ...k, label } : k)), changed())),
    deleteKey: (id: number) => wait((vaultKeys = vaultKeys.filter((k) => k.id !== id), changed())),
    revealPrivateKey: (_id: number, pw: string) => (pw === 'wrong' ? Promise.reject(new Error('Wrong password')) : wait('9f1c'.repeat(16), 300)),
    revealMnemonic: () => wait({ phrase: PHRASE }, 300),
    listNodes: () => wait(nodes),
    saveNode: (n: any) => wait((nodes = { ...nodes, nodes: [...nodes.nodes.filter((x) => x.id !== n.id), { ...n, id: n.id || String(Date.now()) }] })),
    deleteNode: (id: string) => wait((nodes = { ...nodes, nodes: nodes.nodes.filter((x) => x.id !== id) })),
    selectNode: (net: NetworkId, id: string) => wait((nodes = { ...nodes, selected: { ...nodes.selected, [net]: id } })),
    testNode: (n: any) => wait(n.fullHost.includes('127.0.0.1') ? { ok: false, latencyMs: 4, error: 'fetch failed (ECONNREFUSED)' } : { ok: true, latencyMs: 284, block: 70484606 }, 500),
    getNetwork: () => wait(network),
    setNetwork: (n: NetworkId) => wait((network = n)),
    balances: (a: string) =>
      network === 'mainnet' && a === fileKeys[1].address
        ? Promise.reject(new Error('Rate limited by api.trongrid.io (HTTP 429). Add an API key for this node (nodes) or wait a moment.'))
        : wait(balances[a] ?? bal(a, 0, 0, false)),
    listSRs: () =>
      wait(
        Array.from({ length: 24 }, (_, i) => ({
          address: `TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCs${String(i).padStart(3, '0')}`,
          name: ['Poloniex', 'Binance Staking', 'JustLend DAO', 'TRONLink', 'Ankr', 'HTX', 'BitTorrent', 'Sesameseed'][i % 8] + (i >= 8 ? ` ${i}` : ''),
          votes: 3_000_000_000 - i * 97_000_000
        }))
      ),
    getPermissions: (address: string) =>
      wait({
        // #1's owner was moved to #2 (the scenario: owner = another keys.json address)
        owner: {
          type: 0, id: 0, permission_name: 'owner', threshold: 1,
          keys: [{ address: address === fileKeys[0].address ? fileKeys[1].address : address, weight: 1 }]
        },
        witness: null,
        actives: [{ type: 2, id: 2, permission_name: 'active0', threshold: 1, operations: DEFAULT_OPS, keys: [{ address, weight: 1 }] }]
      }),
    delegationInfo: (a: string) =>
      wait({
        out: a === fileKeys[0].address
          ? [
              { address: vaultKeys[0].address, resource: 'ENERGY', amount: 400, lockedUntil: 0 },
              { address: 'TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp', resource: 'ENERGY', amount: 100, lockedUntil: Date.now() + 86400e3 * 2 }
            ]
          : [],
        in: a === vaultKeys[0].address ? [{ address: fileKeys[0].address, resource: 'ENERGY', amount: 400, lockedUntil: 0 }] : [],
        maxDelegatable: a === fileKeys[0].address ? { energy: 1500, bandwidth: 500 } : { energy: 0, bandwidth: 0 },
        maxLockPeriodBlocks: 864000
      }),
    delegate: tx, undelegate: tx, cancelUnstakes: tx,
    getMemoFee: () => wait(1),
    estimateTx: (action: string, _id: number, args: any[], opts?: any) => {
      const fees: { label: string; trx: number }[] = []
      if (action === 'sendTrx' && args[0] === vaultKeys[1].address) fees.push({ label: 'activate new account', trx: 1 })
      if (opts?.note) fees.push({ label: 'note (memo)', trx: 1 })
      if ((opts?.signers?.length ?? 0) > 1) fees.push({ label: 'multi-signature', trx: 1 })
      if (action === 'updatePermissions') fees.push({ label: 'permission update', trx: 100 })
      const energy = action === 'sendUsdt' ? { required: 64895, available: 50800, burnTrx: 1.4095 } : { required: 0, available: 50800, burnTrx: 0 }
      const total = energy.burnTrx + fees.reduce((x, f) => x + f.trx, 0)
      return wait({ bytes: action === 'sendUsdt' ? 345 : 267, bandwidth: { source: 'staked', available: { staked: 390, free: 600 }, burnTrx: 0 }, energy, fees, totalTrx: total, warnings: [] }, 250)
    },
    rewardInfo: () => wait({ claimable: 12.483921, lastClaim: Date.now() - 3 * 86400e3, nextClaim: Date.now() - 2 * 86400e3 }),
    claimRewards: plainTx,
    txReceipt: () => wait({ found: true, result: 'SUCCESS', feeTrx: 0.345, energy: 13045, bandwidth: 345, block: 70485000 }),
    historyQuery: (_a: string, q: any) => {
      const merged = mergeFeeds(mockAll, mockTrc20)
      const ranged = inRange(merged, q.days)
      const filtered = applyFilters(ranged, q.filters, new Map())
      const days = dayList(q.days)
      const pages = Math.max(1, Math.ceil(filtered.length / q.pageSize))
      const page = Math.min(q.page, pages - 1)
      const usdtFrom = dayKey(Date.now() - 40 * 864e5)
      const pts = q.usdtBalance == null ? [] : usdtSeries(mockTrc20, q.usdtBalance, days)
      const status = (feed: string, list: any[]) => ({
        feed, count: list.length, complete: feed !== 'usdt', syncedAt: Date.now() - 60e3,
        newest: list[0]?.time, oldest: feed === 'usdt' ? Date.now() - 40 * 864e5 : list[list.length - 1]?.time
      })
      return wait({
        rows: filtered.slice(page * q.pageSize, (page + 1) * q.pageSize),
        page, pageSize: q.pageSize, total: filtered.length, rangeTotal: ranged.length, cachedTotal: merged.length,
        counts: [...kindCounts(ranged)], totals: totals(filtered), buckets: feeBuckets(filtered, days), weekly: days.length > 120,
        usdt: { points: usdtFrom > days[0] ? pts.filter((p) => p.day >= usdtFrom) : pts, count: mockTrc20.filter((x) => x.isUsdt).length, cutFrom: usdtFrom > days[0] ? usdtFrom : undefined },
        status: [status('all', mockAll), status('trc20', mockTrc20), status('usdt', mockTrc20.filter((x) => x.isUsdt))],
        syncing: false, source: { host: 'api.shasta.trongrid.io', fallback: false }, path: '/Users/you/projects/tron_wallet/cache.sqlite'
      }, 80)
    },
    historySync: () => wait([], 1200),
    historyStop: () => wait(undefined),
    historyClear: () => wait(undefined),
    onHistoryProgress: () => () => {},
    // live mode mock: a block every 3 s, sometimes a tx for one of the keys
    liveSet: (on: boolean) => {
      clearInterval(liveTimer)
      liveOn = on
      if (on) liveTimer = setInterval(liveTick, 3000)
      return wait({ enabled: on, ok: true, block: liveBlock })
    },
    onLiveStatus: (cb: any) => (liveListeners.status.add(cb), () => liveListeners.status.delete(cb)),
    onLiveActivity: (cb: any) => (liveListeners.activity.add(cb), () => liveListeners.activity.delete(cb)),
    onLiveGap: () => () => {},
    balanceHistory: (_a: string, days: number) =>
      wait({ points: mockDaily.slice(-Math.min(days, mockDaily.length)), source: 'shastapi.tronscan.org' }, 400),
    inspectTx: (json: string) => { try { return wait(summarize(json)) } catch (e) { return Promise.reject(e) } },
    signTx: (json: string, ids: number[]) => {
      const m = JSON.parse(json)
      const all = [...fileKeys, ...vaultKeys]
      m.signed = [...m.signed, ...ids.map((id) => all.find((k) => k.id === id)!.address)]
      const j = JSON.stringify(m)
      return wait({ json: j, summary: summarize(j) }, 300)
    },
    broadcastTx: () => wait({ txid: 'f'.repeat(64), ok: true }, 400),
    sendTrx: tx, sendUsdt: tx, stake: tx, unstake: tx, withdrawUnfrozen: tx, vote: tx, updatePermissions: tx,
    explorerUrl: (id: string) => wait(`https://shasta.tronscan.org/#/transaction/${id}`)
  }
}
