# Tron Wallet (MVP)

A minimal desktop wallet for experimenting with TRON transaction types on **Shasta** / **Nile** testnets (with a Mainnet toggle).

Features: balances & resources, Send TRX, Send USDT (TRC20), Stake 2.0 (stake / unstake / withdraw / cancel unstakes), resource delegation (delegate / reclaim, optional lock), Vote for SRs, Account Permissions (owner/active, multisig). Every form has an optional `Permission ID` field for multisig tests.

## Setup

```bash
npm install
cp keys.example.json keys.json   # then fill in your keys
npm run dev
```

`keys.json` (git-ignored) is an array of `{ "id": number, "address": "T...", "privateKey": "hex" }`.
Private keys are only read in the Electron main process and never sent to the UI.

## Vault & address generation

Besides `keys.json` you can keep keys in an encrypted **vault** (`vault.json` next to `keys.json`, git-ignored).
Both sources show up in the address list (tagged `file`, `hd`, `random`, `imported`, `watch`), and `getKey(id)`
looks in `keys.json` first, then in the vault.

- Create / unlock / lock from the top of the sidebar. Auto-locks after 15 minutes of inactivity.
- Encryption: scrypt (N=2^17, r=8, p=1) + AES-256-GCM. While unlocked only the derived key is kept in memory
  (main process). Private keys never reach the UI unless you use *show private key* (asks for the password again).
- **HD seeds**: generate a 12/24-word BIP39 seed or import one (optional BIP39 passphrase), then *derive next*
  addresses at `m/44'/195'/0'/0/i` (the standard TRON path used by TronLink / Ledger).
- **Single keys**: random key, import a private key, or add a watch-only address.
- **Settings**: import all `keys.json` entries into the vault, change password.
- New addresses are not on chain until they receive TRX: select one and use *fund* to send 1 TRX from a funded key.

Get Shasta test TRX from the faucet: https://shasta.tronex.io

## UI

Monospace (IBM Plex Mono), flat, light and dark themes (toggle in the header; defaults to the OS setting).

Preview the UI in a normal browser with fake data: run `npm run dev` and open `http://localhost:5173`
(when the Electron preload is missing, a dev-only mock API is used).

## Notes, signing and multisig

Every transaction form has:

- **note**: a memo stored on chain in `raw_data.data` (UTF-8). The network charges a memo fee (shown next to the field,
  `getMemoFee`, 1 TRX on Shasta/mainnet at the time of writing).
- **signing** (collapsed by default):
  - *permission id*: `0` owner, `2+` active permissions.
  - *signers*: which keys sign (`keys.json` or vault). Empty means the account's own key. The account itself can be
    watch-only, so you can operate a multisig account whose keys are held by others.
  - *valid for*: tx lifetime in minutes (default ~1 min, max 24 h). Raise it when other people still need to sign.

Every signer is checked against the tx's permission before signing. If the signatures reach the permission threshold
the tx is broadcast; otherwise it is kept as **pending** (log: `pending 1/2 · open in sign-tx`).

The **sign-tx** tab works with plain TRON transaction JSON (so it interoperates with TronWeb / wallet-cli):
paste one or open a pending one, see the decoded contract (TRC20 transfers included), note, permission, expiry and
which keys signed, add signatures with the keys you have, copy the JSON for other signers, and broadcast when ready.
Pasted transactions are verified with `txCheck` (the readable `raw_data` must match the signed `raw_data_hex` and txID).

## Delegation

The `delegate` tab lends energy or bandwidth from staked TRX to another address (Stake 2.0 `DelegateResource`).
It shows how much you can delegate right now, lets you lock a delegation for a number of days (capped by the chain's
`getMaxDelegateLockPeriod`, 3 s blocks), and lists delegations out (with *reclaim*, full or partial, disabled while
locked) and received.

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
| `VAULT_FILE` | Path to a vault file other than `vault.json` next to the keys file |
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
- `src/main/multisig.ts`: signing pipeline (note, expiration, signer checks, weight, broadcast) and sign-tx tools
- `src/main/client.ts`: TronWeb client for the active node / network
- `src/main/vault.ts`: encrypted vault, HD derivation, key import/export
- `src/main/nodes.ts`: node list, selection, API keys, connection test
- `src/shared/operations.ts`: operations bitmask encode/decode + contract type list
- `src/renderer/src/`: React UI
