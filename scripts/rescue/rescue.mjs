#!/usr/bin/env node
/**
 * rescue.mjs: move a compromised account's permissions away from a sweeper bot.
 *
 * Situation: the private key of VICTIM leaked and a bot sweeps every deposit as soon as it sees it in a block.
 * VICTIM has no TRX, so it cannot pay the 100 TRX AccountPermissionUpdate fee by itself.
 *
 *   TX1  FUNDER -> VICTIM   (fee + small buffer)
 *   TX2  VICTIM: AccountPermissionUpdate  owner + active (+ witness) -> NEW_OWNER
 *
 * Goal: TX1 and TX2 land in the SAME block, TX2 after TX1. When the bot sees the deposit, the leaked key is
 * no longer allowed to sign for VICTIM and its sweep fails.
 *
 * How:
 *  - both txs are built locally (TronWeb with an explicit blockHeader: no node call, no balance check) and signed
 *    before anything is sent
 *  - the script waits for a new block, then broadcasts TX1 and, as soon as the node accepted it, TX2, to the SAME
 *    node (the node validates TX2 on top of its pending state, which already contains TX1)
 *  - then it checks which blocks they landed in and their order
 *
 * Default is a dry run (build + sign + checks, nothing sent). Add --fire to broadcast.
 * Use your own full node or a fixed provider node: a load balanced endpoint (public TronGrid) can route the two
 * broadcasts to different nodes, and then TX2 is rejected because that node has not seen TX1 yet.
 *
 * Run `node scripts/rescue/rescue.mjs --help` for options.
 */
import { readFileSync } from 'node:fs'
import { TronWeb, utils } from 'tronweb'

const SUN = 1_000_000
const MAINNET_GENESIS = '00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc'
// Active permission operations: all regular contract types incl. Stake 2.0, without AccountPermissionUpdate (46).
// Same default the wallet app uses (src/shared/operations.ts); accepted by Shasta.
const DEFAULT_ACTIVE_OPS = '77ff0fc0023ef30f000000000000000000000000000000000000000000000000'
const START = Date.now()

// ---------------------------------------------------------------- args

const HELP = `
Usage: node scripts/rescue/rescue.mjs [options]

Required
  --node <url>            full node HTTP API (one fixed node, e.g. http://127.0.0.1:8090)   env RESCUE_NODE
  --new-owner <address>   address that becomes owner + active (+ witness) of the victim  env RESCUE_NEW_OWNER

Keys (pick one way; never pass private keys as arguments)
  env RESCUE_FUNDER_PK, RESCUE_VICTIM_PK
  --keys <file> --funder <id> --victim <id>     keys.json format: [{ id, address, privateKey }]

Optional
  --api-key <key>         env RESCUE_API_KEY
  --api-key-in <header|url>        default header (url: appended as /<key>, or replaces {key} in --node)
  --api-key-header <name>          default TRON-PRO-API-KEY
  --amount <trx>          TRX sent to the victim. Default: permission update fee + 2 TRX
  --expire-min <n>        lifetime of both txs, default 15 (max 1440)
  --ref-depth <n>         blocks behind head used as reference block, default 20
  --extra-node <url>      after the primary node accepted both, also send them here (repeatable)
  --no-wait-block         fire right away instead of at the start of a new block
  --fire                  actually broadcast (default: dry run)
  --yes-mainnet           required together with --fire on mainnet
  --help
`

function parseArgs(argv) {
  const out = { extraNodes: [] }
  const flags = new Set(['fire', 'yes-mainnet', 'no-wait-block', 'help'])
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`)
    const name = a.slice(2)
    if (flags.has(name)) {
      out[name] = true
      continue
    }
    const v = argv[++i]
    if (v === undefined) throw new Error(`Missing value for --${name}`)
    if (name === 'extra-node') out.extraNodes.push(v)
    else out[name] = v
  }
  return out
}

// ---------------------------------------------------------------- utils

const ms = () => `${String(Date.now() - START).padStart(6)} ms`
const log = (...a) => console.log(`[${ms()}]`, ...a)
const fail = (msg) => {
  console.error(`\nABORT: ${msg}`)
  process.exit(1)
}
const sleep = (t) => new Promise((r) => setTimeout(r, t))
const trx = (sun) => `${(Number(sun) / SUN).toLocaleString('en-US', { maximumFractionDigits: 6 })} TRX`
const hexToB58 = (h) => (h?.startsWith('41') ? TronWeb.address.fromHex(h) : h)

function nodeMessage(res) {
  const m = res?.message ? String(res.message) : ''
  const decoded = /^[0-9a-fA-F]+$/.test(m) ? Buffer.from(m, 'hex').toString('utf8') : m
  return `${res?.code ?? 'ERROR'}${decoded ? `: ${decoded}` : ''}`
}

/** Minimal HTTP client for one node (keep-alive connection, so the hot path does not pay for a handshake). */
function client(url, { apiKey, apiKeyIn = 'header', apiKeyHeader = 'TRON-PRO-API-KEY' } = {}) {
  let base = url.replace(/\/+$/, '')
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey && apiKeyIn === 'url') base = base.includes('{key}') ? base.replace('{key}', apiKey) : `${base}/${apiKey}`
  else if (apiKey) headers[apiKeyHeader] = apiKey
  const label = new URL(url.replace('{key}', 'key')).host
  return {
    label,
    async post(path, body = {}) {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000)
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`${label}${path}: HTTP ${res.status} ${text.slice(0, 200)}`)
      try {
        return JSON.parse(text)
      } catch {
        throw new Error(`${label}${path}: not JSON: ${text.slice(0, 200)}`)
      }
    }
  }
}

function loadKeys(args) {
  if (args.keys) {
    if (!args.funder || !args.victim) fail('--keys needs --funder <id> and --victim <id>')
    const list = JSON.parse(readFileSync(args.keys, 'utf8'))
    const get = (id) => list.find((k) => String(k.id) === String(id)) ?? fail(`id ${id} not found in ${args.keys}`)
    return { funderPk: get(args.funder).privateKey, victimPk: get(args.victim).privateKey }
  }
  const funderPk = process.env.RESCUE_FUNDER_PK
  const victimPk = process.env.RESCUE_VICTIM_PK
  if (!funderPk || !victimPk) fail('set RESCUE_FUNDER_PK and RESCUE_VICTIM_PK, or use --keys/--funder/--victim')
  return { funderPk, victimPk }
}

/** keys of a permission as base58 addresses */
const permKeys = (p) => (p?.keys ?? []).map((k) => hexToB58(k.address))

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return console.log(HELP)

  const nodeUrl = args.node ?? process.env.RESCUE_NODE ?? fail('--node is required (one fixed full node)')
  const newOwner = args['new-owner'] ?? process.env.RESCUE_NEW_OWNER ?? fail('--new-owner is required')
  const apiOpts = {
    apiKey: args['api-key'] ?? process.env.RESCUE_API_KEY,
    apiKeyIn: args['api-key-in'] ?? 'header',
    apiKeyHeader: args['api-key-header'] ?? 'TRON-PRO-API-KEY'
  }
  const expireMin = Math.min(Math.max(Number(args['expire-min'] ?? 15), 2), 1440)
  const refDepth = Math.max(Number(args['ref-depth'] ?? 20), 1)

  const { funderPk, victimPk } = loadKeys(args)
  const pk = (k) => String(k).replace(/^0x/, '')
  const funder = TronWeb.address.fromPrivateKey(pk(funderPk)) || fail('invalid funder private key')
  const victim = TronWeb.address.fromPrivateKey(pk(victimPk)) || fail('invalid victim private key')
  if (!TronWeb.isAddress(newOwner) || !newOwner.startsWith('T')) fail(`--new-owner is not a valid address: ${newOwner}`)
  if (newOwner === victim) fail('--new-owner must not be the victim address (its key is leaked)')

  const node = client(nodeUrl, apiOpts)
  if (/(^|\.)trongrid\.io$/.test(new URL(nodeUrl.replace('{key}', 'key')).hostname)) {
    console.warn(
      'WARNING: TronGrid is load balanced. TX1 and TX2 may reach different nodes and TX2 can be rejected.\n' +
        '         Prefer your own full node or a provider endpoint that pins one node.\n'
    )
  }

  // ---------------- preflight (all reads happen here, before anything is signed or sent)
  log(`node ${node.label}`)
  const [genesis, head, params, victimAcc, funderAcc] = await Promise.all([
    node.post('/wallet/getblockbynum', { num: 0 }),
    node.post('/wallet/getnowblock'),
    node.post('/wallet/getchainparameters'),
    node.post('/wallet/getaccount', { address: victim, visible: true }),
    node.post('/wallet/getaccount', { address: funder, visible: true })
  ])
  const mainnet = genesis?.blockID === MAINNET_GENESIS
  const param = (k, d) => Number(params?.chainParameter?.find((p) => p.key === k)?.value ?? d)
  const updateFee = param('getUpdateAccountPermissionFee', 100 * SUN)
  const activationFee = param('getCreateNewAccountFeeInSystemContract', SUN) + param('getCreateAccountFee', 0.1 * SUN)
  const headNum = head?.block_header?.raw_data?.number ?? fail('could not read head block')

  const victimExists = !!victimAcc?.address
  const funderBalance = Number(funderAcc?.balance ?? 0)
  const amount = args.amount ? Math.round(Number(args.amount) * SUN) : updateFee + 2 * SUN
  if (!(amount > 0)) fail('invalid --amount')
  if (amount < updateFee) fail(`--amount ${trx(amount)} is below the permission update fee ${trx(updateFee)}`)

  // the leaked key must still control the owner permission, otherwise TX2 cannot be signed
  const owner = victimAcc?.owner_permission
  const ownerKeys = owner ? permKeys(owner) : [victim]
  if (!ownerKeys.includes(victim)) {
    fail(`victim owner permission is no longer the leaked key (owner keys: ${ownerKeys.join(', ')}). Too late for this.`)
  }
  if (owner && Number(owner.threshold ?? 1) > 1) {
    fail(`victim owner threshold is ${owner.threshold}; this script signs with a single key`)
  }
  const isWitness = !!victimAcc?.is_witness
  const funderNeeds = amount + (victimExists ? 0 : activationFee) + 0.5 * SUN

  console.log(`
  network        ${mainnet ? 'MAINNET' : `not mainnet (genesis ${String(genesis?.blockID).slice(0, 16)}...)`}
  head block     ${headNum}
  funder         ${funder}  balance ${trx(funderBalance)}
  victim         ${victim}  ${victimExists ? `balance ${trx(victimAcc.balance ?? 0)}` : 'NOT ACTIVATED (TX1 creates it)'}
    owner keys   ${ownerKeys.join(', ')}
    active keys  ${(victimAcc?.active_permission ?? []).map((p) => `${p.permission_name}[${permKeys(p).join(', ')}]`).join(' ') || '(default: victim key)'}
    witness      ${isWitness ? `yes (${permKeys(victimAcc?.witness_permission).join(', ') || 'victim key'})` : 'no'}
  new owner      ${newOwner}
  TX1 amount     ${trx(amount)}   (permission update fee ${trx(updateFee)}${victimExists ? '' : `, funder also pays activation ~${trx(activationFee)}`})
  tx lifetime    ${expireMin} min`)

  if (funderBalance < funderNeeds) fail(`funder has ${trx(funderBalance)}, needs about ${trx(funderNeeds)}`)

  // ---------------- build both txs locally on a shared reference block
  const ref = await node.post('/wallet/getblockbynum', { num: headNum - refDepth })
  if (!ref?.blockID) fail('could not read reference block')
  const timestamp = Date.now()
  const blockHeader = {
    ref_block_bytes: Number(ref.block_header.raw_data.number).toString(16).padStart(16, '0').slice(12, 16),
    ref_block_hash: ref.blockID.slice(16, 32),
    timestamp,
    expiration: timestamp + expireMin * 60_000
  }

  // TronWeb needs a host to be constructed; with blockHeader set the builders do not call it.
  const t = new TronWeb({ fullHost: 'http://127.0.0.1:1' })
  const tx1 = await t.transactionBuilder.sendTrx(victim, amount, funder, { blockHeader })
  const ownerPerm = { type: 0, permission_name: 'owner', threshold: 1, keys: [{ address: newOwner, weight: 1 }] }
  const activePerm = {
    type: 2,
    permission_name: 'active',
    threshold: 1,
    operations: process.env.RESCUE_ACTIVE_OPS ?? DEFAULT_ACTIVE_OPS,
    keys: [{ address: newOwner, weight: 1 }]
  }
  const witnessPerm = isWitness
    ? { type: 1, permission_name: 'witness', threshold: 1, keys: [{ address: newOwner, weight: 1 }] }
    : null
  // replaces ALL active permissions: the leaked key keeps nothing
  const tx2 = await t.transactionBuilder.updateAccountPermissions(victim, ownerPerm, witnessPerm, [activePerm], {
    blockHeader
  })

  const signed1 = await t.trx.sign(tx1, pk(funderPk))
  const signed2 = await t.trx.sign(tx2, pk(victimPk))
  for (const [name, tx] of [
    ['TX1', signed1],
    ['TX2', signed2]
  ]) {
    if (!utils.transaction.txCheck(tx)) fail(`${name} failed the local integrity check`)
  }
  log(`built + signed locally (ref block ${ref.block_header.raw_data.number})`)
  console.log(`  TX1 ${signed1.txID}  ${funder} -> ${victim}  ${trx(amount)}`)
  console.log(`  TX2 ${signed2.txID}  owner/active${isWitness ? '/witness' : ''} of ${victim} -> ${newOwner}`)

  if (!args.fire) {
    console.log('\nDRY RUN: nothing was sent. Re-run with --fire to broadcast.')
    return
  }
  if (mainnet && !args['yes-mainnet']) fail('this is MAINNET: add --yes-mainnet together with --fire')

  // ---------------- fire
  if (!args['no-wait-block']) {
    // start of a block window = longest time for both txs to sit in the same pending pool
    log('waiting for the next block...')
    let n = headNum
    const startWait = Date.now()
    while (n <= headNum) {
      if (Date.now() - startWait > 15_000) fail('no new block in 15 s')
      await sleep(80)
      n = (await node.post('/wallet/getnowblock'))?.block_header?.raw_data?.number ?? n
    }
    log(`new block ${n}, firing`)
  }

  const t0 = performance.now()
  const r1 = await node.post('/wallet/broadcasttransaction', signed1)
  const t1 = performance.now()
  if (!r1?.result) fail(`TX1 rejected: ${nodeMessage(r1)}`)
  log(`TX1 accepted (${(t1 - t0).toFixed(0)} ms)`)

  // the node validates TX2 on top of its pending state; retry briefly in case TX1 is not applied yet
  let r2
  for (let attempt = 1; attempt <= 10; attempt++) {
    r2 = await node.post('/wallet/broadcasttransaction', signed2)
    if (r2?.result) break
    const msg = nodeMessage(r2)
    if (!/balance is not sufficient|does not exist|not exist|insufficient/i.test(msg)) break
    log(`TX2 attempt ${attempt}: ${msg}, retrying`)
    await sleep(20)
  }
  const t2 = performance.now()
  if (!r2?.result) {
    console.error(`\nTX2 REJECTED: ${nodeMessage(r2)}`)
    console.error('TX1 is out. Broadcast TX2 again RIGHT NOW (same node), it is valid until expiration:')
    console.error(JSON.stringify(signed2))
    process.exit(2)
  }
  log(`TX2 accepted (${(t2 - t1).toFixed(0)} ms after TX1, ${(t2 - t0).toFixed(0)} ms total)`)

  for (const url of args.extraNodes) {
    const extra = client(url, apiOpts)
    for (const [name, tx] of [
      ['TX1', signed1],
      ['TX2', signed2]
    ]) {
      extra
        .post('/wallet/broadcasttransaction', tx)
        .then((r) => log(`extra ${extra.label} ${name}: ${r?.result ? 'ok' : nodeMessage(r)}`))
        .catch((e) => log(`extra ${extra.label} ${name}: ${e.message}`))
    }
  }

  // ---------------- confirm
  log('waiting for both txs to be mined...')
  const info = {}
  const deadline = Date.now() + 90_000
  while ((!info.tx1 || !info.tx2) && Date.now() < deadline) {
    await sleep(500)
    for (const [k, id] of [
      ['tx1', signed1.txID],
      ['tx2', signed2.txID]
    ]) {
      if (info[k]) continue
      const r = await node.post('/wallet/gettransactioninfobyid', { value: id }).catch(() => ({}))
      if (r?.id) {
        info[k] = r
        log(`${k.toUpperCase()} in block ${r.blockNumber}${r.receipt?.result && r.receipt.result !== 'SUCCESS' ? ` (${r.receipt.result})` : ''}${r.result === 'FAILED' ? ' FAILED' : ''}`)
      }
    }
  }
  if (!info.tx1 || !info.tx2) fail('not both txs found within 90 s; check them on an explorer')

  const b1 = info.tx1.blockNumber
  const b2 = info.tx2.blockNumber
  if (b1 === b2) {
    const block = await node.post('/wallet/getblockbynum', { num: b1 })
    const ids = (block?.transactions ?? []).map((x) => x.txID)
    const i1 = ids.indexOf(signed1.txID)
    const i2 = ids.indexOf(signed2.txID)
    console.log(`\nSAME BLOCK ${b1}: TX1 at index ${i1}, TX2 at index ${i2} of ${ids.length}${i1 < i2 ? ' (correct order)' : ''}`)
  } else {
    console.log(`\nDIFFERENT BLOCKS: TX1 in ${b1}, TX2 in ${b2} (${b2 - b1} block gap). The bot had a window; check the victim.`)
  }

  const after = await node.post('/wallet/getaccount', { address: victim, visible: true })
  const nowOwner = permKeys(after?.owner_permission)
  const nowActive = (after?.active_permission ?? []).flatMap(permKeys)
  const okOwner = nowOwner.length === 1 && nowOwner[0] === newOwner
  const okActive = nowActive.length > 0 && nowActive.every((a) => a === newOwner)
  console.log(`victim owner  ${nowOwner.join(', ')}  ${okOwner ? 'OK' : 'NOT CHANGED'}`)
  console.log(`victim active ${nowActive.join(', ')}  ${okActive ? 'OK' : 'NOT CHANGED'}`)
  console.log(`victim balance ${trx(after?.balance ?? 0)}`)
  process.exit(okOwner && okActive ? 0 : 3)
}

main().catch((e) => fail(e?.stack ?? e))
