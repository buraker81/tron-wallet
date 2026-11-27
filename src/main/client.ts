import { TronWeb } from 'tronweb'
import { NETWORKS } from './networks'
import { activeNode, nodeHeaders, nodePolicy, nodeQueueKey, nodeUrl } from './nodes'
import { throttled } from './ratelimit'
import type { NetworkId } from '../shared/types'

export const SUN = 1_000_000

let current: NetworkId = 'shasta'

export const getNetwork = (): NetworkId => current
export function setNetwork(n: NetworkId): NetworkId {
  if (!NETWORKS[n]) throw new Error(`Unknown network: ${n}`)
  current = n
  return current
}

const cache = new Map<string, TronWeb>()

/**
 * TronWeb bound to the active node of the current network. No default key: every signer is explicit.
 * Every HTTP request goes through the node's rate-limit queue (see ratelimit.ts). Instances are cached per
 * node URL + headers + pacing, so a node edit (new key, new URL) gets a fresh instance.
 */
export function tw(): TronWeb {
  const node = activeNode(current)
  const url = nodeUrl(node)
  const headers = nodeHeaders(node)
  const policy = nodePolicy(node)
  const id = JSON.stringify([url, headers, policy])
  let t = cache.get(id)
  if (!t) {
    t = new TronWeb({ fullHost: url, headers })
    const queue = nodeQueueKey(node)
    for (const provider of [t.fullNode, t.solidityNode, t.eventServer] as any[]) {
      if (!provider?.request) continue
      const request = provider.request.bind(provider)
      provider.request = (path: string, payload?: unknown, method?: string) =>
        throttled(queue, policy, () => request(path, payload, method))
    }
    cache.set(id, t)
  }
  return t
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
