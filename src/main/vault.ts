/**
 * Encrypted vault: HD mnemonics + generated / imported / watch-only keys.
 *
 * File format (vault.json, next to keys.json, git-ignored):
 *   { version, kdf: { name: 'scrypt', N, r, p, salt }, cipher: 'aes-256-gcm', iv, tag, data }
 * `data` is the AES-256-GCM ciphertext of the JSON VaultData below. The key is derived
 * from the password with scrypt. While unlocked only the derived key is kept in memory.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { TronWeb, utils } from 'tronweb'
import type { KeySource, MnemonicInfo, VaultStatus } from '../shared/types'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>
const ethers: any = (utils as any).ethersUtils

const KDF = { N: 2 ** 17, r: 8, p: 1 }
const MAXMEM = 256 * 1024 * 1024
const AUTO_LOCK_MS = 15 * 60 * 1000
export const TRON_PATH = (index: number) => `m/44'/195'/0'/0/${index}`

interface StoredMnemonic {
  id: string
  name: string
  phrase: string
  passphrase?: string
  nextIndex: number
  createdAt: number
}

export interface VaultKey {
  id: number
  label: string
  address: string
  privateKey?: string
  source: Exclude<KeySource, 'file'>
  hd?: { mnemonicId: string; index: number; path: string }
  createdAt: number
}

interface VaultData {
  mnemonics: StoredMnemonic[]
  keys: VaultKey[]
}

interface VaultFile {
  version: 1
  kdf: { name: 'scrypt'; N: number; r: number; p: number; salt: string }
  cipher: 'aes-256-gcm'
  iv: string
  tag: string
  data: string
}

// ---------- state ----------

let session: { key: Buffer; file: VaultFile; data: VaultData } | null = null
let lockTimer: NodeJS.Timeout | undefined
let onChange: () => void = () => {}

export const vaultPath = (keysFile: string): string =>
  process.env.VAULT_FILE || join(dirname(keysFile), 'vault.json')

let pathFn: () => string = () => {
  throw new Error('vault path not configured')
}

/** Wire up file location and a callback fired whenever lock state or contents change. */
export function initVault(getPath: () => string, changed: () => void): void {
  pathFn = getPath
  onChange = changed
}

function touch(): void {
  clearTimeout(lockTimer)
  lockTimer = setTimeout(lock, AUTO_LOCK_MS)
}

function requireUnlocked(): { key: Buffer; file: VaultFile; data: VaultData } {
  if (!session) throw new Error(existsSync(pathFn()) ? 'Vault is locked' : 'No vault yet. Create one first.')
  touch()
  return session
}

// ---------- crypto ----------

const deriveKey = (password: string, salt: Buffer, k = KDF) =>
  scrypt(password, salt, 32, { N: k.N, r: k.r, p: k.p, maxmem: MAXMEM })

function encrypt(key: Buffer, kdf: VaultFile['kdf'], data: VaultData): VaultFile {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()])
  return {
    version: 1,
    kdf,
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    tag: c.getAuthTag().toString('hex'),
    data: ct.toString('base64')
  }
}

function decrypt(key: Buffer, f: VaultFile): VaultData {
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(f.iv, 'hex'))
  d.setAuthTag(Buffer.from(f.tag, 'hex'))
  const pt = Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()])
  return JSON.parse(pt.toString('utf8'))
}

function writeAtomic(file: VaultFile): void {
  const p = pathFn()
  const tmp = `${p}.tmp`
  writeFileSync(tmp, JSON.stringify(file, null, 2), { mode: 0o600 })
  renameSync(tmp, p)
}

function save(): void {
  const s = requireUnlocked()
  s.file = encrypt(s.key, s.file.kdf, s.data)
  writeAtomic(s.file)
  onChange()
}

const readFile = (): VaultFile => {
  const f = JSON.parse(readFileSync(pathFn(), 'utf8'))
  if (f?.version !== 1 || f?.kdf?.name !== 'scrypt') throw new Error('Unsupported vault file format')
  return f
}

function checkPassword(password: string): void {
  if (password.length < 8) throw new Error('Password must be at least 8 characters')
}

/** Re-derive from a typed password and compare to the session key (for reveal / change password). */
async function verifyPassword(password: string): Promise<void> {
  const s = requireUnlocked()
  const k = await deriveKey(password, Buffer.from(s.file.kdf.salt, 'hex'), s.file.kdf)
  if (!timingSafeEqual(k, s.key)) throw new Error('Wrong password')
}

// ---------- lifecycle ----------

export function status(): VaultStatus {
  return {
    exists: existsSync(pathFn()),
    unlocked: !!session,
    path: pathFn(),
    autoLockMinutes: AUTO_LOCK_MS / 60000
  }
}

export async function create(password: string): Promise<VaultStatus> {
  if (existsSync(pathFn())) throw new Error('A vault already exists at this path')
  checkPassword(password)
  const salt = randomBytes(16)
  const kdf = { name: 'scrypt' as const, ...KDF, salt: salt.toString('hex') }
  const key = await deriveKey(password, salt)
  const data: VaultData = { mnemonics: [], keys: [] }
  const file = encrypt(key, kdf, data)
  writeAtomic(file)
  session = { key, file, data }
  touch()
  onChange()
  return status()
}

export async function unlock(password: string): Promise<VaultStatus> {
  const file = readFile()
  const key = await deriveKey(password, Buffer.from(file.kdf.salt, 'hex'), file.kdf)
  let data: VaultData
  try {
    data = decrypt(key, file)
  } catch {
    throw new Error('Wrong password')
  }
  session = { key, file, data }
  touch()
  onChange()
  return status()
}

export function lock(): VaultStatus {
  if (session) session.key.fill(0)
  session = null
  clearTimeout(lockTimer)
  onChange()
  return status()
}

export async function changePassword(oldPw: string, newPw: string): Promise<VaultStatus> {
  await verifyPassword(oldPw)
  checkPassword(newPw)
  const s = requireUnlocked()
  const salt = randomBytes(16)
  s.key = await deriveKey(newPw, salt)
  s.file.kdf = { name: 'scrypt', ...KDF, salt: salt.toString('hex') }
  save()
  return status()
}

// ---------- reads ----------

export const isUnlocked = (): boolean => !!session

/** Public view of vault keys (no secrets). Empty when locked. */
export function listVaultKeys(): VaultKey[] {
  return session ? session.data.keys.map(({ privateKey: _pk, ...k }) => k) : []
}

export function getVaultKey(id: number): VaultKey | undefined {
  if (!session) return undefined
  touch()
  return session.data.keys.find((k) => k.id === id)
}

export function listMnemonics(): MnemonicInfo[] {
  const s = requireUnlocked()
  return s.data.mnemonics.map((m) => ({
    id: m.id,
    name: m.name,
    words: m.phrase.split(' ').length,
    hasPassphrase: !!m.passphrase,
    nextIndex: m.nextIndex,
    derived: s.data.keys.filter((k) => k.hd?.mnemonicId === m.id).length,
    createdAt: m.createdAt
  }))
}

// ---------- writes ----------

/** ids must stay unique across keys.json and the vault, so the caller passes the current max. */
let maxExternalId: () => number = () => 0
export function setExternalIdSource(fn: () => number): void {
  maxExternalId = fn
}
function nextId(data: VaultData): number {
  return Math.max(0, maxExternalId(), ...data.keys.map((k) => k.id)) + 1
}

function addKey(k: Omit<VaultKey, 'id' | 'createdAt'>): VaultKey {
  const s = requireUnlocked()
  const dup = s.data.keys.find((x) => x.address === k.address)
  if (dup) throw new Error(`Address already in vault as #${dup.id}`)
  const key: VaultKey = { ...k, id: nextId(s.data), createdAt: Date.now() }
  s.data.keys.push(key)
  return key
}

const strip = ({ privateKey: _pk, ...k }: VaultKey) => k

export function createMnemonic(name: string, words: 12 | 24, passphrase?: string): { id: string; phrase: string } {
  const s = requireUnlocked()
  const m = ethers.Mnemonic.fromEntropy(randomBytes(words === 24 ? 32 : 16))
  const entry: StoredMnemonic = {
    id: randomBytes(6).toString('hex'),
    name: name.trim() || `seed ${s.data.mnemonics.length + 1}`,
    phrase: m.phrase,
    passphrase: passphrase || undefined,
    nextIndex: 0,
    createdAt: Date.now()
  }
  s.data.mnemonics.push(entry)
  save()
  return { id: entry.id, phrase: entry.phrase }
}

export function importMnemonic(name: string, phrase: string, passphrase?: string): MnemonicInfo[] {
  const s = requireUnlocked()
  const clean = phrase.trim().toLowerCase().split(/\s+/).join(' ')
  if (!ethers.isValidMnemonic(clean)) throw new Error('Invalid mnemonic (BIP39 English wordlist)')
  if (s.data.mnemonics.some((m) => m.phrase === clean && (m.passphrase || '') === (passphrase || ''))) {
    throw new Error('This mnemonic is already in the vault')
  }
  s.data.mnemonics.push({
    id: randomBytes(6).toString('hex'),
    name: name.trim() || `seed ${s.data.mnemonics.length + 1}`,
    phrase: clean,
    passphrase: passphrase || undefined,
    nextIndex: 0,
    createdAt: Date.now()
  })
  save()
  return listMnemonics()
}

/** Derive the next `count` addresses of a mnemonic at m/44'/195'/0'/0/i. */
export function deriveNext(mnemonicId: string, count = 1, labelPrefix?: string) {
  const s = requireUnlocked()
  const m = s.data.mnemonics.find((x) => x.id === mnemonicId)
  if (!m) throw new Error('Mnemonic not found')
  const n = Math.min(Math.max(1, Math.floor(count)), 50)
  const created: VaultKey[] = []
  for (let i = 0; i < n; i++) {
    const index = m.nextIndex
    const path = TRON_PATH(index)
    const acc: any = TronWeb.fromMnemonic(m.phrase, path, m.passphrase ?? null)
    m.nextIndex++
    if (s.data.keys.some((k) => k.address === acc.address)) continue
    created.push(
      addKey({
        label: `${labelPrefix?.trim() || m.name}/${index}`,
        address: acc.address,
        privateKey: acc.privateKey.replace(/^0x/, ''),
        source: 'hd',
        hd: { mnemonicId: m.id, index, path }
      })
    )
  }
  save()
  return created.map(strip)
}

export async function createRandomKey(label: string) {
  const acc: any = await TronWeb.createAccount()
  const k = addKey({ label: label.trim() || 'random', address: acc.address.base58, privateKey: acc.privateKey, source: 'random' })
  save()
  return strip(k)
}

export function importPrivateKey(label: string, privateKey: string) {
  const pk = privateKey.trim().replace(/^0x/, '')
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) throw new Error('Private key must be 64 hex characters')
  const address = TronWeb.address.fromPrivateKey(pk)
  if (!address) throw new Error('Invalid private key')
  const k = addKey({ label: label.trim() || 'imported', address, privateKey: pk.toLowerCase(), source: 'imported' })
  save()
  return strip(k)
}

export function addWatchOnly(label: string, address: string) {
  const a = address.trim()
  if (!TronWeb.isAddress(a) || !a.startsWith('T')) throw new Error('Invalid TRON address')
  const k = addKey({ label: label.trim() || 'watch', address: a, source: 'watch' })
  save()
  return strip(k)
}

/** Copy keys.json entries into the vault as imported keys (skips addresses already there). */
export function importFromFile(entries: { address: string; privateKey: string }[]): { added: number; skipped: number } {
  const s = requireUnlocked()
  let added = 0
  let skipped = 0
  for (const e of entries) {
    if (s.data.keys.some((k) => k.address === e.address)) {
      skipped++
      continue
    }
    const pk = e.privateKey.replace(/^0x/, '')
    if (TronWeb.address.fromPrivateKey(pk) !== e.address) {
      skipped++
      continue
    }
    addKey({ label: 'from keys.json', address: e.address, privateKey: pk, source: 'imported' })
    added++
  }
  save()
  return { added, skipped }
}

export function renameKey(id: number, label: string): void {
  const s = requireUnlocked()
  const k = s.data.keys.find((x) => x.id === id)
  if (!k) throw new Error('Key not found in vault')
  k.label = label.trim()
  save()
}

export function deleteKey(id: number): void {
  const s = requireUnlocked()
  const before = s.data.keys.length
  s.data.keys = s.data.keys.filter((k) => k.id !== id)
  if (s.data.keys.length === before) throw new Error('Key not found in vault')
  save()
}

export async function revealPrivateKey(id: number, password: string): Promise<string> {
  await verifyPassword(password)
  const k = getVaultKey(id)
  if (!k) throw new Error('Key not found in vault')
  if (!k.privateKey) throw new Error('Watch-only address has no private key')
  return k.privateKey
}

export async function revealMnemonic(id: string, password: string): Promise<{ phrase: string; passphrase?: string }> {
  await verifyPassword(password)
  const m = requireUnlocked().data.mnemonics.find((x) => x.id === id)
  if (!m) throw new Error('Mnemonic not found')
  return { phrase: m.phrase, passphrase: m.passphrase }
}
