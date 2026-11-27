// Dev-only fake API for previewing the UI in a browser. Never used inside Electron.
import type { Balances, NetworkId, NodeState } from '../../shared/types'
import { DEFAULT_OPS } from '../../shared/operations'

const keys = [
  { id: 1, address: 'TXyZjVcYurrbE43b2MfMtN34uA3tJL85zy' },
  { id: 2, address: 'TUjAyePMcSGPyeCcsNRjTLxZkYMTF9UyAA' },
  { id: 3, address: 'TT2RHcg9JRU3LFx8sPukc9UizBYF8D44U2' },
  { id: 4, address: 'TQpzvGQ9Xzn2UfVTn9uvBRV9riqSjvZ1U7' }
]

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
  votes: trx > 1000 ? [{ address: 'TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp', count: 1500 }] : []
})

const balances: Record<string, Balances> = {
  [keys[0].address]: bal(keys[0].address, 4821.553, 129.5),
  [keys[1].address]: bal(keys[1].address, 98.2, 0),
  [keys[2].address]: bal(keys[2].address, 12, 0),
  [keys[3].address]: bal(keys[3].address, 0, 0, false)
}

let network: NetworkId = 'shasta'
let nodes: NodeState = {
  path: '/Users/you/projects/tron_wallet/nodes.json',
  selected: { shasta: 'trongrid-shasta', nile: 'trongrid-nile', mainnet: 'trongrid-mainnet' },
  nodes: [
    { id: 'trongrid-shasta', name: 'TronGrid Shasta', network: 'shasta', fullHost: 'https://api.shasta.trongrid.io', apiKey: 'a1b2c3d4-0000-1111-2222-333344445555', builtin: true },
    { id: 'local', name: 'local java-tron', network: 'shasta', fullHost: 'http://127.0.0.1:8090', apiKey: '' },
    { id: 'trongrid-nile', name: 'TronGrid Nile', network: 'nile', fullHost: 'https://nile.trongrid.io', apiKey: '', builtin: true },
    { id: 'trongrid-mainnet', name: 'TronGrid Mainnet', network: 'mainnet', fullHost: 'https://api.trongrid.io', apiKey: '', builtin: true }
  ]
}

const wait = <T>(v: T, ms = 150) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const tx = () => wait({ txid: Math.random().toString(16).slice(2).padEnd(64, 'a'), ok: Math.random() > 0.3, message: 'CONTRACT_VALIDATE_ERROR: balance is not sufficient' }, 400)

export function installMockApi() {
  ;(window as any).api = {
    listKeys: () => wait({ keys, path: '/Users/you/projects/tron_wallet/keys.json' }),
    listNodes: () => wait(nodes),
    saveNode: (n: any) => wait((nodes = { ...nodes, nodes: [...nodes.nodes.filter((x) => x.id !== n.id), { ...n, id: n.id || String(Date.now()) }] })),
    deleteNode: (id: string) => wait((nodes = { ...nodes, nodes: nodes.nodes.filter((x) => x.id !== id) })),
    selectNode: (net: NetworkId, id: string) => wait((nodes = { ...nodes, selected: { ...nodes.selected, [net]: id } })),
    testNode: (n: any) => wait(n.fullHost.includes('127.0.0.1') ? { ok: false, latencyMs: 4, error: 'fetch failed (ECONNREFUSED)' } : { ok: true, latencyMs: 284, block: 70484606 }, 500),
    getNetwork: () => wait(network),
    setNetwork: (n: NetworkId) => wait((network = n)),
    balances: (a: string) => wait(balances[a]),
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
        owner: { type: 0, id: 0, permission_name: 'owner', threshold: 1, keys: [{ address, weight: 1 }] },
        witness: null,
        actives: [{ type: 2, id: 2, permission_name: 'active0', threshold: 1, operations: DEFAULT_OPS, keys: [{ address, weight: 1 }] }]
      }),
    sendTrx: tx, sendUsdt: tx, stake: tx, unstake: tx, withdrawUnfrozen: tx, vote: tx, updatePermissions: tx,
    explorerUrl: (id: string) => wait(`https://shasta.tronscan.org/#/transaction/${id}`)
  }
}
