# Tron Wallet (MVP)

A minimal desktop wallet for experimenting with TRON transaction types on **Shasta** / **Nile** testnets (with a Mainnet toggle).

Features: balances & resources, Send TRX, Send USDT (TRC20), Stake 2.0 (stake / unstake / withdraw), Vote for SRs, Account Permissions (owner/active, multisig). Every form has an optional `Permission ID` field for multisig tests.

## Setup

```bash
npm install
cp keys.example.json keys.json   # then fill in your keys
npm run dev
```

`keys.json` (git-ignored) is an array of `{ "id": number, "address": "T...", "privateKey": "hex" }`.
Private keys are only read in the Electron main process and never sent to the UI.

Get Shasta test TRX from the faucet: https://shasta.tronex.io

## UI

Monospace (IBM Plex Mono), flat, light and dark themes (toggle in the header; defaults to the OS setting).

Preview the UI in a normal browser with fake data: run `npm run dev` and open `http://localhost:5173`
(when the Electron preload is missing, a dev-only mock API is used).

## Nodes

Use the node dropdown in the header to pick the active node per network, and the **Nodes** button to manage them:
add your own (e.g. a local java-tron at `http://127.0.0.1:8090`), edit, delete, test (latest block + latency), and
see/edit API keys. TronGrid nodes for each network are built in.

Nodes are stored in `nodes.json` next to `keys.json` (git-ignored because it holds API keys).

## Permissions: operations bitmask

Active permissions have an `operations` field: a 32-byte hex mask of allowed contract types. In the Permissions tab you
build it with checkboxes (grouped, with presets like *Transfers only* or *Stake & vote*). You can also paste raw hex,
and the checkboxes update. Bit `N % 8` of byte `N / 8` enables contract type id `N`.

## Config (env vars)

| Var | Purpose |
|---|---|
| `KEYS_FILE` | Path to a keys file other than `./keys.json` |
| `NODES_FILE` | Path to a nodes file other than `nodes.json` next to the keys file |
| `TRONGRID_API_KEY` | Fallback API key for the built-in TronGrid nodes (when none is saved in the app) |
| `SHASTA_USDT` | Shasta USDT contract (default `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`) |
| `NILE_USDT` | Nile USDT contract (default `TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf`) |

## Notes

- Mainnet: a red border + badge is shown, and every transaction asks for confirmation.
- A vote transaction replaces all previous votes. You need staked TRX (Tron Power) to vote.
- Permission updates cost 100 TRX. A wrong owner permission can lock the account forever.

## Code map

- `src/main/key.ts`: `Key` interface, `getKey(id)`, `listKeys()`
- `src/main/tron.ts`: all TronWeb reads/writes
- `src/main/networks.ts`: Shasta / Nile / Mainnet defaults + USDT contracts
- `src/main/nodes.ts`: node list, selection, API keys, connection test
- `src/shared/operations.ts`: operations bitmask encode/decode + contract type list
- `src/renderer/src/`: React UI
