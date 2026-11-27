import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { listKeys, keysPath, loadFileKeys } from './key'
import * as vault from './vault'
import * as tron from './tron'
import * as nodes from './nodes'
import * as multisig from './multisig'
import { estimateTx } from './estimate'
import * as hist from './history'
import * as historyCache from './historyCache'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    title: 'Tron Wallet',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: false
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Wrap handlers so errors reach the renderer as readable messages.
function handle(channel: string, fn: (...args: any[]) => any): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? String(err) }
    }
  })
}

app.whenReady().then(() => {
  vault.initVault(
    () => vault.vaultPath(keysPath()),
    () => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('vault-changed'))
  )

  handle('listKeys', () => {
    const path = keysPath()
    try {
      const keys = listKeys()
      const fileMissing = !existsSync(path) && !vault.status().exists
      return { keys, path, error: fileMissing ? `No keys.json at ${path} and no vault yet` : undefined }
    } catch (e: any) {
      return { keys: [], error: e.message, path }
    }
  })
  handle('vaultStatus', vault.status)
  handle('vaultCreate', vault.create)
  handle('vaultUnlock', vault.unlock)
  handle('vaultLock', vault.lock)
  handle('vaultChangePassword', vault.changePassword)
  handle('listMnemonics', vault.listMnemonics)
  handle('createMnemonic', vault.createMnemonic)
  handle('importMnemonic', vault.importMnemonic)
  handle('deriveNext', vault.deriveNext)
  handle('createRandomKey', vault.createRandomKey)
  handle('importPrivateKey', vault.importPrivateKey)
  handle('addWatchOnly', vault.addWatchOnly)
  handle('importKeysFile', () => vault.importFromFile(loadFileKeys()))
  handle('renameKey', vault.renameKey)
  handle('deleteKey', vault.deleteKey)
  handle('revealPrivateKey', vault.revealPrivateKey)
  handle('revealMnemonic', vault.revealMnemonic)
  handle('listNodes', nodes.listNodes)
  handle('saveNode', nodes.saveNode)
  handle('deleteNode', nodes.deleteNode)
  handle('selectNode', nodes.selectNode)
  handle('testNode', nodes.testNode)
  handle('getNetwork', tron.getNetwork)
  handle('setNetwork', tron.setNetwork)
  handle('balances', tron.balances)
  handle('listSRs', tron.listSRs)
  handle('getPermissions', tron.getPermissions)
  handle('sendTrx', tron.sendTrx)
  handle('sendUsdt', tron.sendUsdt)
  handle('stake', tron.stake)
  handle('unstake', tron.unstake)
  handle('withdrawUnfrozen', tron.withdrawUnfrozen)
  handle('vote', tron.vote)
  handle('cancelUnstakes', tron.cancelUnstakes)
  handle('delegationInfo', tron.delegationInfo)
  handle('getMemoFee', multisig.getMemoFee)
  handle('estimateTx', estimateTx)
  handle('rewardInfo', tron.rewardInfo)
  handle('claimRewards', tron.claimRewards)
  handle('historyData', historyCache.historyData)
  handle('historySync', historyCache.syncHistory)
  handle('historyStop', historyCache.stopHistorySync)
  handle('historyClear', historyCache.clearHistory)
  handle('balanceHistory', historyCache.balanceHistoryCached)
  handle('txReceipt', hist.txReceipt)
  handle('inspectTx', multisig.inspectTx)
  handle('signTx', multisig.signTx)
  handle('broadcastTx', multisig.broadcastTx)
  handle('delegate', tron.delegate)
  handle('undelegate', tron.undelegate)
  handle('updatePermissions', tron.updatePermissions)
  handle('explorerUrl', tron.explorerUrl)

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
