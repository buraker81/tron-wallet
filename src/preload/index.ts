import { contextBridge, ipcRenderer } from 'electron'

const channels = [
  'listKeys', 'getNetwork', 'setNetwork', 'balances', 'listSRs', 'getPermissions',
  'sendTrx', 'sendUsdt', 'stake', 'unstake', 'withdrawUnfrozen', 'vote',
  'updatePermissions', 'explorerUrl'
]

const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
for (const ch of channels) {
  api[ch] = async (...args) => {
    const res = await ipcRenderer.invoke(ch, ...args)
    if (!res.ok) throw new Error(res.error)
    return res.data
  }
}

contextBridge.exposeInMainWorld('api', api)
