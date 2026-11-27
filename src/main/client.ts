import { TronWeb } from 'tronweb'
import { NETWORKS } from './networks'
import { activeNode, nodeHeaders } from './nodes'
import type { NetworkId } from '../shared/types'

export const SUN = 1_000_000

let current: NetworkId = 'shasta'

export const getNetwork = (): NetworkId => current
export function setNetwork(n: NetworkId): NetworkId {
  if (!NETWORKS[n]) throw new Error(`Unknown network: ${n}`)
  current = n
  return current
}

/** TronWeb bound to the active node of the current network. No default key: every signer is explicit. */
export function tw(): TronWeb {
  const node = activeNode(current)
  return new TronWeb({ fullHost: node.fullHost, headers: nodeHeaders(node) })
}

export const toBase58 = (addr: string): string => (addr.startsWith('T') ? addr : TronWeb.address.fromHex(addr))

/** Decode a node error message (often hex encoded). */
export function nodeMessage(res: any, fallback: string): string {
  let message = res?.code ? String(res.code) : fallback
  if (res?.message) {
    const m = String(res.message)
    const decoded = /^[0-9a-fA-F]+$/.test(m) ? Buffer.from(m, 'hex').toString('utf8') : m
    message += `: ${decoded}`
  }
  return message
}
