/**
 * Fee / resource estimate for an action, using the same builder that would send it.
 *
 * Model (java-tron):
 * - Bandwidth: tx bytes ≈ raw_data + signatures (67 B each) + 64 B result overhead. Staked bandwidth is
 *   used first, then the free daily allowance; if neither covers the whole tx, bytes × getTransactionFee is burned.
 *   Creating a new account (TRX to an inactive address) cannot use free bandwidth: it uses staked bandwidth or burns
 *   getCreateAccountFee, plus getCreateNewAccountFeeInSystemContract.
 * - Energy (smart contracts): available energy is used first, the rest is burned at getEnergyFee per unit.
 * - Fixed extras: memo fee, multi-signature fee (> 1 signature), account permission update fee.
 */
import { getAddress, listKeys } from './key'
import { NETWORKS } from './networks'
import { SUN, getNetwork, tw } from './client'
import { prepare, signersFor } from './multisig'
import { BUILDERS, USDT_FEE_LIMIT_TRX } from './tron'
import type { FeeEstimate, TxAction, TxOptions } from '../shared/types'

const SIG_BYTES = 67
const RESULT_BYTES = 64

export async function estimateTx(action: TxAction, id: number, args: any[], opts?: TxOptions): Promise<FeeEstimate> {
  const t = tw()
  const owner = getAddress(id)
  const [tx0, params, res]: any[] = await Promise.all([
    BUILDERS[action](t, owner, args, opts),
    t.trx.getChainParameters(),
    t.trx.getAccountResources(owner).catch(() => ({}))
  ])
  const tx = await prepare(t, tx0, opts)
  const p = (k: string, d = 0) => Number(params.find((x: any) => x.key === k)?.value ?? d)

  // signature count of the real tx (explicit signers, or what automatic selection would pick)
  const signerIds = await signersFor(t, tx, id, opts).catch(() => [id])
  const sigs = Math.max(1, new Set(signerIds.map((sid) => listKeys().find((k) => k.id === sid)?.address)).size)
  const bytes = tx.raw_data_hex.length / 2 + 3 + sigs * SIG_BYTES + RESULT_BYTES
  const staked = Math.max(0, (res?.NetLimit ?? 0) - (res?.NetUsed ?? 0))
  const free = Math.max(0, (res?.freeNetLimit ?? 0) - (res?.freeNetUsed ?? 0))
  const fees: FeeEstimate['fees'] = []
  const warnings: string[] = []
  if (res?.freeNetLimit === undefined) warnings.push('sender account is not activated yet, the tx will fail')

  // new account creation (TRX transfer to an inactive address)
  let createsAccount = false
  if (action === 'sendTrx') {
    const to: any = await t.trx.getAccount(args[0]).catch(() => ({}))
    createsAccount = !to || Object.keys(to).length === 0
  }

  let bandwidth: FeeEstimate['bandwidth']
  if (createsAccount) {
    const burn = staked >= bytes ? 0 : p('getCreateAccountFee', 100_000) / SUN
    bandwidth = { source: burn ? 'burn' : 'staked', available: { staked, free }, burnTrx: burn }
    fees.push({ label: 'activate new account', trx: p('getCreateNewAccountFeeInSystemContract', 1_000_000) / SUN })
  } else if (staked >= bytes) {
    bandwidth = { source: 'staked', available: { staked, free }, burnTrx: 0 }
  } else if (free >= bytes) {
    bandwidth = { source: 'free', available: { staked, free }, burnTrx: 0 }
  } else {
    bandwidth = { source: 'burn', available: { staked, free }, burnTrx: (bytes * p('getTransactionFee', 1000)) / SUN }
  }

  // energy: only smart contract calls
  let required = 0
  if (action === 'sendUsdt') {
    const call = [
      NETWORKS[getNetwork()].usdt,
      'transfer(address,uint256)',
      {},
      [
        { type: 'address', value: args[0] },
        { type: 'uint256', value: BigInt(Math.round(args[1] * SUN)).toString() }
      ],
      owner
    ] as const
    try {
      const e: any = await t.transactionBuilder.estimateEnergy(...(call as any as [string, string, object, any[], string]))
      required = Number(e?.energy_required ?? 0)
    } catch {
      // nodes without /wallet/estimateenergy: fall back to a constant call
      const c: any = await t.transactionBuilder.triggerConstantContract(...(call as any as [string, string, object, any[], string]))
      required = Number(c?.energy_used ?? 0) + Number(c?.energy_penalty ?? 0)
      warnings.push('energy from a constant call (node has no estimateenergy), may be low')
      if (c?.result?.result === false || c?.result?.message) {
        warnings.push(`contract call would fail: ${Buffer.from(c.result.message ?? '', 'hex').toString('utf8') || 'revert'}`)
      }
    }
  }
  const availEnergy = Math.max(0, (res?.EnergyLimit ?? 0) - (res?.EnergyUsed ?? 0))
  const energyBurn = (Math.max(0, required - availEnergy) * p('getEnergyFee', 100)) / SUN
  if (action === 'sendUsdt' && energyBurn > USDT_FEE_LIMIT_TRX) {
    warnings.push(`energy cost ${energyBurn.toFixed(2)} trx is above the ${USDT_FEE_LIMIT_TRX} trx fee limit, the tx would fail`)
  }

  if (tx.raw_data.data) fees.push({ label: 'note (memo)', trx: p('getMemoFee') / SUN })
  if (sigs > 1) fees.push({ label: 'multi-signature', trx: p('getMultiSignFee') / SUN })
  if (action === 'updatePermissions') {
    fees.push({ label: 'permission update', trx: p('getUpdateAccountPermissionFee', 100_000_000) / SUN })
  }

  const totalTrx = bandwidth.burnTrx + energyBurn + fees.reduce((s, f) => s + f.trx, 0)
  return {
    bytes,
    bandwidth,
    energy: { required, available: availEnergy, burnTrx: energyBurn },
    fees,
    totalTrx,
    warnings
  }
}
