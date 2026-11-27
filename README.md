# Tron Wallet (MVP)

A minimal desktop wallet for experimenting with TRON transaction types on **Shasta testnet** (with a Mainnet toggle).

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

## Config (env vars)

| Var | Purpose |
|---|---|
| `KEYS_FILE` | Path to a keys file other than `./keys.json` |
| `TRONGRID_API_KEY` | TronGrid API key (recommended to avoid rate limits) |
| `SHASTA_USDT` | Shasta USDT contract (default `TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs`) |

## Notes

- Mainnet: a red border + badge is shown, and every transaction asks for confirmation.
- A vote transaction replaces all previous votes. You need staked TRX (Tron Power) to vote.
- Permission updates cost 100 TRX. A wrong owner permission can lock the account forever.

## Code map

- `src/main/key.ts`: `Key` interface, `getKey(id)`, `listKeys()`
- `src/main/tron.ts`: all TronWeb reads/writes
- `src/main/networks.ts`: Shasta / Mainnet endpoints + USDT contracts
- `src/renderer/src/`: React UI
