import type { NetworkId } from '../shared/types'

export interface Network {
  id: NetworkId
  label: string
  /** Default public node (TronGrid). Seeded into nodes.json as a built-in node. */
  fullHost: string
  usdt: string
  explorer: string
  /** Tronscan API host (daily account analysis, used for the balance chart) */
  tronscanApi: string
}

export const NETWORKS: Record<NetworkId, Network> = {
  shasta: {
    id: 'shasta',
    label: 'Shasta',
    fullHost: 'https://api.shasta.trongrid.io',
    // Commonly used Shasta test USDT. Override with SHASTA_USDT env var.
    usdt: process.env.SHASTA_USDT || 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    explorer: 'https://shasta.tronscan.org/#/transaction/',
    tronscanApi: 'https://shastapi.tronscan.org'
  },
  nile: {
    id: 'nile',
    label: 'Nile',
    fullHost: 'https://nile.trongrid.io',
    // Nile test USDT. Override with NILE_USDT env var.
    usdt: process.env.NILE_USDT || 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf',
    explorer: 'https://nile.tronscan.org/#/transaction/',
    tronscanApi: 'https://nileapi.tronscan.org'
  },
  mainnet: {
    id: 'mainnet',
    label: 'Mainnet',
    fullHost: 'https://api.trongrid.io',
    usdt: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    explorer: 'https://tronscan.org/#/transaction/',
    tronscanApi: 'https://apilist.tronscanapi.com'
  }
}
