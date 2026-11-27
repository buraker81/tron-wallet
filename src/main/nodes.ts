import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { keysPath } from './key'
import { NETWORKS } from './networks'
import type { NetworkId, NodeConfig, NodeState, NodeTestResult } from '../shared/types'

const DEFAULT_HEADER = 'TRON-PRO-API-KEY'

/** nodes.json sits next to keys.json. Override with NODES_FILE. It holds API keys: keep it out of git. */
export const nodesPath = (): string => process.env.NODES_FILE || join(dirname(keysPath()), 'nodes.json')

const builtins = (): NodeConfig[] =>
  (Object.keys(NETWORKS) as NetworkId[]).map((n) => ({
    id: `trongrid-${n}`,
    name: `TronGrid ${NETWORKS[n].label}`,
    network: n,
    fullHost: NETWORKS[n].fullHost,
    apiKey: '',
    builtin: true
  }))

const defaultSelected = (): Record<NetworkId, string> =>
  Object.fromEntries((Object.keys(NETWORKS) as NetworkId[]).map((n) => [n, `trongrid-${n}`])) as Record<
    NetworkId,
    string
  >

let state: Omit<NodeState, 'path'> | null = null

function load(): Omit<NodeState, 'path'> {
  if (state) return state
  let saved: Partial<Omit<NodeState, 'path'>> = {}
  if (existsSync(nodesPath())) {
    try {
      saved = JSON.parse(readFileSync(nodesPath(), 'utf8'))
    } catch (e: any) {
      throw new Error(`nodes.json is not valid JSON: ${e.message}`)
    }
  }
  const nodes = [...(saved.nodes ?? [])]
  // make sure every built-in exists (new networks added later get seeded too)
  for (const b of builtins()) if (!nodes.some((n) => n.id === b.id)) nodes.push(b)
  const selected = { ...defaultSelected(), ...(saved.selected ?? {}) }
  for (const net of Object.keys(selected) as NetworkId[]) {
    if (!nodes.some((n) => n.id === selected[net] && n.network === net)) selected[net] = `trongrid-${net}`
  }
  state = { nodes, selected }
  return state
}

function persist(): NodeState {
  writeFileSync(nodesPath(), JSON.stringify(state, null, 2))
  return listNodes()
}

export const listNodes = (): NodeState => ({ ...load(), path: nodesPath() })

export function activeNode(network: NetworkId): NodeConfig {
  const s = load()
  return s.nodes.find((n) => n.id === s.selected[network])!
}

export function nodeHeaders(node: NodeConfig): Record<string, string> {
  // built-in TronGrid nodes fall back to the TRONGRID_API_KEY env var when no key is saved
  const key = node.apiKey || (node.builtin ? process.env.TRONGRID_API_KEY : '')
  return key ? { [node.apiKeyHeader || DEFAULT_HEADER]: key } : {}
}

function validate(node: NodeConfig): void {
  if (!node.name?.trim()) throw new Error('Node name is required')
  if (!NETWORKS[node.network]) throw new Error(`Unknown network: ${node.network}`)
  try {
    const u = new URL(node.fullHost)
    if (!/^https?:$/.test(u.protocol)) throw new Error()
  } catch {
    throw new Error('Full host must be a valid http(s) URL')
  }
}

export function saveNode(input: NodeConfig): NodeState {
  const s = load()
  const node: NodeConfig = {
    ...input,
    name: input.name.trim(),
    fullHost: input.fullHost.trim().replace(/\/+$/, ''),
    apiKey: input.apiKey?.trim() || '',
    apiKeyHeader: input.apiKeyHeader?.trim() || undefined
  }
  validate(node)
  const i = s.nodes.findIndex((n) => n.id === node.id)
  if (i >= 0) {
    const prev = s.nodes[i]
    // built-ins keep their identity; only name / api key are editable
    s.nodes[i] = prev.builtin
      ? { ...prev, name: node.name, apiKey: node.apiKey, apiKeyHeader: node.apiKeyHeader }
      : { ...node, builtin: false }
    if (!prev.builtin && prev.network !== node.network && s.selected[prev.network] === prev.id) {
      s.selected[prev.network] = `trongrid-${prev.network}`
    }
  } else {
    s.nodes.push({ ...node, id: randomUUID(), builtin: false })
  }
  return persist()
}

export function deleteNode(id: string): NodeState {
  const s = load()
  const node = s.nodes.find((n) => n.id === id)
  if (!node) throw new Error('Node not found')
  if (node.builtin) throw new Error('Built-in nodes cannot be deleted')
  s.nodes = s.nodes.filter((n) => n.id !== id)
  if (s.selected[node.network] === id) s.selected[node.network] = `trongrid-${node.network}`
  return persist()
}

export function selectNode(network: NetworkId, id: string): NodeState {
  const s = load()
  if (!s.nodes.some((n) => n.id === id && n.network === network)) throw new Error('Node not found for this network')
  s.selected[network] = id
  return persist()
}

/** Pings /wallet/getnowblock and reports latency + latest block height. */
export async function testNode(node: NodeConfig): Promise<NodeTestResult> {
  const start = Date.now()
  try {
    const res = await fetch(`${node.fullHost.replace(/\/+$/, '')}/wallet/getnowblock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...nodeHeaders(node) },
      signal: AbortSignal.timeout(8000)
    })
    const latencyMs = Date.now() - start
    if (!res.ok) return { ok: false, latencyMs, error: `HTTP ${res.status} ${res.statusText}`.trim() }
    const body: any = await res.json()
    const block = body?.block_header?.raw_data?.number
    if (block === undefined) return { ok: false, latencyMs, error: body?.Error || 'Unexpected response' }
    return { ok: true, latencyMs, block }
  } catch (e: any) {
    const cause = e?.cause?.code || e?.cause?.message
    const error = e?.name === 'TimeoutError' ? 'Timeout (8s)' : cause ? `${e.message} (${cause})` : e?.message
    return { ok: false, latencyMs: Date.now() - start, error }
  }
}
