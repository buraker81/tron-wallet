import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { listKeys, keysPath } from './key'
import * as tron from './tron'
import * as nodes from './nodes'

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
  handle('listKeys', () => {
    try {
      return { keys: listKeys(), path: keysPath() }
    } catch (e: any) {
      return { keys: [], error: e.message, path: keysPath() }
    }
  })
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
