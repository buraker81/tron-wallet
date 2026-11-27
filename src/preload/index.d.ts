import type { Api } from '../shared/types'

declare global {
  interface Window {
    api: Api & { explorerUrl(txid: string): Promise<string> }
  }
}
export {}
