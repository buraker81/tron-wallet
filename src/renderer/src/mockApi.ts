// Dev-only fake API for previewing the UI in a browser. Never used inside Electron.
import type { Balances, MnemonicInfo, NetworkId, NodeState, PublicKey, VaultStatus } from '../../shared/types'
import { DEFAULT_OPS } from '../../shared/operations'

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
    history: (_a: string, kind: string) =>
      wait({
        source: 'api.shasta.trongrid.io',
        fallback: false,
        next: undefined,
        items: kind === 'trc20'
          ? [
              { txid: 'a1'.repeat(32), time: Date.now() - 3600e3, type: 'USDT transfer', direction: 'in', counterparty: 'TGNzrfuE14gMxBNwNVdzwFaMLHbm16rrKd', amount: '5.5 usdt', result: 'SUCCESS', feeTrx: 0, energy: 0, bandwidth: 0 },
              { txid: 'b2'.repeat(32), time: Date.now() - 86400e3, type: 'USDT transfer', direction: 'out', counterparty: vaultKeys[0].address, amount: '20 usdt', result: 'SUCCESS', feeTrx: 0, energy: 0, bandwidth: 0 }
            ]
          : [
              { txid: 'c3'.repeat(32), time: Date.now() - 600e3, type: 'Transfer', direction: 'out', counterparty: fileKeys[1].address, amount: '25 trx', result: 'SUCCESS', feeTrx: 0, energy: 0, bandwidth: 267, note: 'treasury payout #42' },
              { txid: 'd4'.repeat(32), time: Date.now() - 7200e3, type: 'TriggerSmartContract', direction: 'out', counterparty: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs', amount: 'token transfer', result: 'SUCCESS', feeTrx: 1.4095, energy: 64895, bandwidth: 345 },
              { txid: 'e5'.repeat(32), time: Date.now() - 9000e3, type: 'DelegateResource', direction: 'out', counterparty: vaultKeys[0].address, amount: '400 trx energy', result: 'SUCCESS', feeTrx: 0, energy: 0, bandwidth: 280 },
              { txid: 'f6'.repeat(32), time: Date.now() - 86400e3, type: 'VoteWitness', direction: 'out', amount: '1500 votes', result: 'SUCCESS', feeTrx: 0, energy: 0, bandwidth: 270 },
              { txid: '07'.repeat(32), time: Date.now() - 90000e3, type: 'TriggerSmartContract', direction: 'out', counterparty: 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs', amount: 'token transfer', result: 'OUT_OF_ENERGY', feeTrx: 6.2, energy: 62000, bandwidth: 345 },
              { txid: '18'.repeat(32), time: Date.now() - 172800e3, type: 'Transfer', direction: 'in', counterparty: 'TGNzrfuE14gMxBNwNVdzwFaMLHbm16rrKd', amount: '5000 trx', result: 'SUCCESS', feeTrx: 0, energy: 0, bandwidth: 0 }
            ]
      }),
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
