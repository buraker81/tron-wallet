import { contextBridge, ipcRenderer } from 'electron'

const channels = [
  'listKeys', 'vaultStatus', 'vaultCreate', 'vaultUnlock', 'vaultLock', 'vaultChangePassword',
  'listMnemonics', 'createMnemonic', 'importMnemonic', 'deriveNext', 'createRandomKey',
  'importPrivateKey', 'addWatchOnly', 'importKeysFile', 'renameKey', 'deleteKey',
  'revealPrivateKey', 'revealMnemonic',
  'listNodes', 'saveNode', 'deleteNode', 'selectNode', 'testNode',
  'getNetwork', 'setNetwork', 'balances', 'listSRs', 'getPermissions',
  'sendTrx', 'sendUsdt', 'stake', 'unstake', 'withdrawUnfrozen', 'vote', 'cancelUnstakes', 'delegationInfo', 'getMemoFee', 'estimateTx', 'rewardInfo', 'claimRewards', 'history', 'txReceipt', 'inspectTx', 'signTx', 'broadcastTx', 'delegate', 'undelegate',
  'updatePermissions', 'explorerUrl'
]

const api: Record<string, (...args: any[]) => unknown> = {}
for (const ch of channels) {
  api[ch] = async (...args) => {
    const res = await ipcRenderer.invoke(ch, ...args)
    if (!res.ok) throw new Error(res.error)
    return res.data
  }
}

api.onVaultChanged = (cb: () => void) => {
  const listener = () => cb()
  ipcRenderer.on('vault-changed', listener)
  return () => ipcRenderer.removeListener('vault-changed', listener)
}

contextBridge.exposeInMainWorld('api', api)
