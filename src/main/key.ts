import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { PublicKey } from '../shared/types'

export interface Key {
  id: number
  address: string
  privateKey: string
}

/** keys.json lives in the project root in dev, next to the app otherwise. Override with KEYS_FILE. */
export function keysPath(): string {
  if (process.env.KEYS_FILE) return process.env.KEYS_FILE
  return app.isPackaged ? join(app.getPath('userData'), 'keys.json') : join(process.cwd(), 'keys.json')
}

function loadKeys(): Key[] {
  const p = keysPath()
  if (!existsSync(p)) throw new Error(`keys.json not found at ${p}`)
  const data = JSON.parse(readFileSync(p, 'utf8'))
  if (!Array.isArray(data)) throw new Error('keys.json must be an array of {id, address, privateKey}')
  return data.map((k) => ({
    id: Number(k.id),
    address: String(k.address),
    privateKey: String(k.privateKey).replace(/^0x/, '')
  }))
}

export function getKey(id: number): Key {
  const key = loadKeys().find((k) => k.id === id)
  if (!key) throw new Error(`Key with id ${id} not found`)
  return key
}

export function listKeys(): PublicKey[] {
  return loadKeys().map(({ id, address }) => ({ id, address }))
}
