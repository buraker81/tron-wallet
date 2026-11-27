import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PublicKey } from '../shared/types'
import * as vault from './vault'

export interface Key {
  id: number
  address: string
  privateKey: string
}

/** keys.json lives in the project root in dev, in userData when packaged. Override with KEYS_FILE. */
export function keysPath(): string {
  if (process.env.KEYS_FILE) return process.env.KEYS_FILE
  return app.isPackaged ? join(app.getPath('userData'), 'keys.json') : join(process.cwd(), 'keys.json')
}

/** Plain keys from keys.json. Returns [] when the file does not exist. */
export function loadFileKeys(): Key[] {
  const p = keysPath()
  if (!existsSync(p)) return []
  const data = JSON.parse(readFileSync(p, 'utf8'))
  if (!Array.isArray(data)) throw new Error('keys.json must be an array of {id, address, privateKey}')
  return data.map((k) => ({
    id: Number(k.id),
    address: String(k.address),
    privateKey: String(k.privateKey).replace(/^0x/, '')
  }))
}

/**
 * Resolve a key by id: keys.json first, then the vault.
 * Throws if the id is unknown, the vault is locked, or the address is watch-only.
 */
export function getKey(id: number): Key {
  const fileKey = loadFileKeys().find((k) => k.id === id)
  if (fileKey) return fileKey
  const v = vault.getVaultKey(id)
  if (v) {
    if (!v.privateKey) throw new Error(`#${id} is watch-only and cannot sign`)
    return { id: v.id, address: v.address, privateKey: v.privateKey }
  }
  if (vault.status().exists && !vault.isUnlocked()) throw new Error(`Key #${id} not found (vault is locked)`)
  throw new Error(`Key with id ${id} not found`)
}

/** All addresses without secrets: keys.json entries followed by vault entries (when unlocked). */
export function listKeys(): PublicKey[] {
  const file: PublicKey[] = loadFileKeys().map(({ id, address }) => ({ id, address, source: 'file', canSign: true }))
  const ids = new Set(file.map((k) => k.id))
  const fromVault: PublicKey[] = vault.listVaultKeys().map((k) => ({
    id: k.id,
    address: k.address,
    label: k.label,
    source: k.source,
    canSign: k.source !== 'watch',
    hd: k.hd
  }))
  const clash = fromVault.find((k) => ids.has(k.id))
  if (clash) throw new Error(`Duplicate id #${clash.id} in keys.json and the vault. Change the id in keys.json.`)
  return [...file, ...fromVault]
}

vault.setExternalIdSource(() => {
  try {
    return Math.max(0, ...loadFileKeys().map((k) => k.id))
  } catch {
    return 0
  }
})
