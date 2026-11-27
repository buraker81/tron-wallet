/**
 * Signing pipeline shared by every action, plus multisig helpers.
 *
 *   build (unsigned) → note (raw_data.data) → extend expiration → check signers → sign → weigh
 *   → broadcast when the permission threshold is reached, otherwise return the partially signed tx.
 *
 * Partially signed transactions are plain TRON transaction JSON, so they can be passed around,
 * signed elsewhere (TronWeb, wallet-cli) and brought back.
 */
import { TronWeb, utils } from 'tronweb'
import { getAddress, getKey } from './key'
import { SUN, getNetwork, nodeMessage, toBase58, tw } from './client'
import type { TxOptions, TxResult, TxSummary } from '../shared/types'

const MAX_EXPIRE_MIN = 24 * 60 - 1
const txCheck: (tx: any) => boolean = (utils as any).transaction.txCheck

// ---------- prepare ----------

/** Adds the note and extends the expiration. Both change the txID, so they must happen before signing. */
async function prepare(t: TronWeb, tx: any, opts?: TxOptions): Promise<any> {
  // TronWeb's local alteration leaves `signature: undefined` behind, which makes the next
  // alteration think the tx is signed. Drop the empty key after each step.
  const clean = (x: any) => {
    if (x.signature === undefined) delete x.signature
    return x
  }
  if (opts?.note?.trim()) {
    tx = clean(await t.transactionBuilder.addUpdateData(tx, opts.note.trim(), 'utf8', { txLocal: true }))
  }
  const minutes = Math.min(opts?.expireMinutes ?? 0, MAX_EXPIRE_MIN)
  if (minutes > 1) {
    const extraSeconds = Math.floor((tx.raw_data.timestamp + minutes * 60_000 - tx.raw_data.expiration) / 1000)
    if (extraSeconds > 0) tx = clean(await t.transactionBuilder.extendExpiration(tx, extraSeconds, { txLocal: true }))
  }
  return tx
}

// ---------- weight ----------

async function signWeight(t: TronWeb, tx: any): Promise<any> {
  const w: any = await t.trx.getSignWeight(tx)
  const code = w?.result?.code
  if (code && code !== 'ENOUGH_PERMISSION' && code !== 'NOT_ENOUGH_PERMISSION') {
    throw new Error(`${code}: ${w.result.message ?? 'permission check failed'}`)
  }
  return w
}

const lower = (a: string) => TronWeb.address.toHex(a).toLowerCase()

/** Sign `tx` with each key id after checking it belongs to the tx's permission and has not signed yet. */
async function signWith(t: TronWeb, tx: any, signerIds: number[]): Promise<any> {
  if (signerIds.length === 0) throw new Error('Pick at least one signer')
  const w = await signWeight(t, tx)
  const permKeys = new Map<string, number>(
    (w.permission?.keys ?? []).map((k: any) => [String(k.address).toLowerCase(), Number(k.weight)])
  )
  const approved = new Set<string>((w.approved_list ?? []).map((a: string) => String(a).toLowerCase()))
  const permName = w.permission?.permission_name ?? `id ${tx.raw_data.contract[0].Permission_id ?? 0}`
  for (const id of signerIds) {
    const key = getKey(id)
    const hex = lower(key.address)
    if (!permKeys.has(hex)) throw new Error(`#${id} ${key.address} is not a key of permission "${permName}"`)
    if (approved.has(hex)) throw new Error(`#${id} ${key.address} already signed this transaction`)
    tx = await t.trx.sign(tx, key.privateKey, false, true)
    approved.add(hex)
  }
  return tx
}

async function broadcast(t: TronWeb, tx: any): Promise<TxResult> {
  const res: any = await t.trx.sendRawTransaction(tx)
  const txid = res?.txid ?? res?.transaction?.txID ?? tx.txID
  return res?.result ? { txid, ok: true } : { txid, ok: false, message: nodeMessage(res, 'Broadcast failed') }
}

/** Broadcast if the signatures reach the threshold, otherwise hand back the partially signed tx. */
async function finish(t: TronWeb, tx: any): Promise<TxResult> {
  const w = await signWeight(t, tx)
  if (w.result?.code === 'ENOUGH_PERMISSION') return broadcast(t, tx)
  const threshold = Number(w.permission?.threshold ?? 1)
  const weight = Number(w.current_weight ?? 0)
  return {
    txid: tx.txID,
    ok: false,
    message: `signed ${weight}/${threshold}, needs more signatures`,
    pending: { json: JSON.stringify(tx), txid: tx.txID, weight, threshold }
  }
}

// ---------- entry point used by every action ----------

/**
 * Build a tx for account `id` (may be watch-only), then sign with `opts.signers` (default: the account's own key).
 * Simple case (own key, no permission id) skips the weight lookup and broadcasts directly.
 */
export async function execute(
  id: number,
  build: (t: TronWeb, owner: string) => Promise<any>,
  opts?: TxOptions
): Promise<TxResult> {
  const t = tw()
  const owner = getAddress(id)
  let tx = await build(t, owner)
  tx = await prepare(t, tx, opts)
  const signers = opts?.signers?.length ? [...new Set(opts.signers)] : [id]
  const simple = signers.length === 1 && signers[0] === id && !opts?.permissionId
  if (simple) {
    tx = await t.trx.sign(tx, getKey(id).privateKey)
    return broadcast(t, tx)
  }
  tx = await signWith(t, tx, signers)
  return finish(t, tx)
}

// ---------- standalone tx tools (sign-tx tab) ----------

function parseTx(json: string): any {
  let tx: any
  try {
    tx = JSON.parse(json)
  } catch {
    throw new Error('Not valid JSON')
  }
  if (tx?.transaction?.raw_data) tx = tx.transaction // accept { transaction: {...} } wrappers
  if (!tx?.raw_data?.contract?.[0] || !tx.txID || !tx.raw_data_hex) {
    throw new Error('Not a TRON transaction (needs txID, raw_data and raw_data_hex)')
  }
  if (!txCheck(tx)) throw new Error('raw_data does not match raw_data_hex / txID (tampered or corrupted transaction)')
  return tx
}

const AMOUNT_FIELDS = new Set(['amount', 'balance', 'frozen_balance', 'unfreeze_balance', 'call_value'])
const isHexAddr = (v: unknown) => typeof v === 'string' && /^41[0-9a-fA-F]{40}$/.test(v)

function describe(value: any): [string, string][] {
  const out: [string, string][] = []
  for (const [k, v] of Object.entries(value ?? {})) {
    if (k === 'owner_address') continue
    if (isHexAddr(v)) out.push([k, toBase58(v as string)])
    else if (AMOUNT_FIELDS.has(k) && typeof v === 'number') out.push([k, `${v / SUN} trx`])
    else if (k === 'data' && typeof v === 'string' && v.startsWith('a9059cbb') && v.length >= 136) {
      // ERC20/TRC20 transfer(address,uint256)
      out.push(['call', 'transfer(address,uint256)'])
      out.push(['token to', toBase58('41' + v.slice(32, 72))])
      out.push(['token amount', `${BigInt('0x' + v.slice(72, 136)).toString()} (raw units, USDT = /1e6)`])
    } else if (k === 'votes' && Array.isArray(v)) {
      out.push(['votes', v.map((x: any) => `${toBase58(x.vote_address)}: ${x.vote_count}`).join(', ')])
    } else if (typeof v === 'object') out.push([k, JSON.stringify(v).slice(0, 300)])
    else out.push([k, String(v)])
  }
  return out
}

async function summarize(t: TronWeb, tx: any): Promise<TxSummary> {
  const c = tx.raw_data.contract[0]
  const w: any = await t.trx.getSignWeight(tx)
  const value = c.parameter?.value ?? {}
  const note = tx.raw_data.data ? Buffer.from(tx.raw_data.data, 'hex').toString('utf8') : undefined
  return {
    txid: tx.txID,
    network: getNetwork(),
    owner: value.owner_address ? toBase58(value.owner_address) : '',
    contractType: c.type,
    params: describe(value),
    permissionId: c.Permission_id ?? 0,
    permissionName: w?.permission?.permission_name ?? '',
    note,
    expiration: tx.raw_data.expiration,
    expired: tx.raw_data.expiration <= Date.now(),
    signatures: tx.signature?.length ?? 0,
    approved: (w?.approved_list ?? []).map(toBase58),
    weight: Number(w?.current_weight ?? 0),
    threshold: Number(w?.permission?.threshold ?? 0),
    keys: (w?.permission?.keys ?? []).map((k: any) => ({ address: toBase58(k.address), weight: Number(k.weight) })),
    status: w?.result?.code ?? 'UNKNOWN',
    statusMessage: w?.result?.message
  }
}

export async function inspectTx(json: string): Promise<TxSummary> {
  return summarize(tw(), parseTx(json))
}

export async function signTx(json: string, signerIds: number[]): Promise<{ json: string; summary: TxSummary }> {
  const t = tw()
  let tx = parseTx(json)
  if (tx.raw_data.expiration <= Date.now()) throw new Error('Transaction has expired')
  tx = await signWith(t, tx, signerIds)
  return { json: JSON.stringify(tx), summary: await summarize(t, tx) }
}

export async function broadcastTx(json: string): Promise<TxResult> {
  const t = tw()
  const tx = parseTx(json)
  if (tx.raw_data.expiration <= Date.now()) throw new Error('Transaction has expired')
  return broadcast(t, tx)
}

export async function getMemoFee(): Promise<number> {
  const params: any[] = await tw().trx.getChainParameters()
  return (params.find((p) => p.key === 'getMemoFee')?.value ?? 0) / SUN
}
