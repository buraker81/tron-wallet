import type { NetworkId } from '../shared/types'

export interface Network {
  id: NetworkId
  fullHost: string
  usdt: string
  explorer: string
}

export const NETWORKS: Record<NetworkId, Network> = {
  shasta: {
    id: 'shasta',
    fullHost: 'https://api.shasta.trongrid.io',
    // Commonly used Shasta test USDT. Override with SHASTA_USDT env var.
    usdt: process.env.SHASTA_USDT || 'TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs',
    explorer: 'https://shasta.tronscan.org/#/transaction/'
  },
  mainnet: {
    id: 'mainnet',
    fullHost: 'https://api.trongrid.io',
    usdt: 'TR7NHqjeKQxGTCi8q8ZY4pxL8otSzgjLj6t',
    explorer: 'https://tronscan.org/#/transaction/'
  }
}
