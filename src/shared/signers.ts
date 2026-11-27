import type { PermissionKey, PublicKey } from './types'

export interface SignerPick {
  /** key ids to sign with, in order */
  ids: number[]
  weight: number
  threshold: number
  enough: boolean
}

/**
 * Pick keys held in this app (keys.json / unlocked vault) that belong to a permission, until the threshold
 * is reached. The account's own key goes first when it is in the permission, then heavier keys first.
 * Duplicate addresses (same key in keys.json and the vault) are used once.
 */
export function pickSigners(
  permKeys: PermissionKey[],
  threshold: number,
  held: PublicKey[],
  ownId: number
): SignerPick {
  const weightOf = new Map(permKeys.map((k) => [k.address, Number(k.weight)]))
  const seen = new Set<string>()
  const candidates = held
    .filter((k) => k.canSign && weightOf.has(k.address))
    .filter((k) => (seen.has(k.address) ? false : (seen.add(k.address), true)))
    .sort((a, b) => Number(b.id === ownId) - Number(a.id === ownId) || weightOf.get(b.address)! - weightOf.get(a.address)!)
  const ids: number[] = []
  let weight = 0
  for (const k of candidates) {
    if (weight >= threshold) break
    ids.push(k.id)
    weight += weightOf.get(k.address)!
  }
  return { ids, weight, threshold, enough: weight >= threshold }
}
