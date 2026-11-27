# Tron Wallet (MVP)

A minimal desktop wallet for experimenting with TRON transaction types on **Shasta** / **Nile** testnets (with a Mainnet toggle).

Features: balances & resources, Send TRX, Send USDT (TRC20), Stake 2.0 (stake / unstake / withdraw / cancel unstakes), resource delegation (delegate / reclaim, optional lock), Vote for SRs + claim rewards, fee estimates, tx history, Account Permissions (owner/active, multisig). Every form has an optional `Permission ID` field for multisig tests.

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

## Fee estimate, receipts and history

- **Estimate**: every form shows the expected cost of the exact tx it would send (same builder, including note,
  signers and permission id), refreshed as you type:
  - bandwidth: tx bytes and whether staked bandwidth, the free daily allowance, or burned TRX pays for it
  - energy (TRC20): `estimateEnergy` (falls back to a constant call), available energy, TRX burned for the rest;
    warns if it would exceed the 100 TRX fee limit
  - fixed fees: new account activation (TRX to an inactive address), memo, multi-signature, permission update
  - fee parameters are read from the chain (`getChainParameters`)
- **Receipts**: after a broadcast the log polls `getTransactionInfo` and shows the real result, fee, energy and
  bandwidth once the tx is in a block (or the failure reason, e.g. `out_of_energy`).
- **History** tab (selected address):
  - history is **cached locally in SQLite** (`cache.sqlite` next to `keys.json`, git-ignored; Electron's built-in
    `node:sqlite`, no native module). Opening the tab shows the cache instantly, then syncs in the background:
    new confirmed txs since the last sync, plus loading older ones (5,000 per feed per run, 20,000 for the USDT feed;
    *load older* continues, so the full history builds up over time). Confirmed txs never change, so each is downloaded
    once. Raw API rows are stored and turned into items when read, so fee / type rules can change without re-downloading.
    Past daily balances are cached too (today is refreshed). *clear cache* deletes one address's cache. Set
    `CACHE_FILE` to use another path.
  - the transaction feed is merged with the TRC20 feed (your own TRC20 sends become one row with the token amount
    and the fees)
  - range `30d · 90d · 1y · all` for everything below
  - **balance chart**: daily TRX balance from the Tronscan API (`account/analysis`, end of day UTC), or USDT balance
    rebuilt from today's balance using the cached official USDT transfers (a separate, contract-filtered feed, so other
    tokens can't crowd it out); until those are cached back to the range start, the chart starts at the oldest cached
    day and says so. Shows start → end and the change
  - **fees burned** by txs this address sent, by cause:
    - resource shortage: bandwidth / energy burned because staked + free resources did not cover the tx
    - fixed fees: account creation (TRX to a new address: 1 TRX system fee + its 0.1 TRX bandwidth fee, with the
      number of accounts created), memo, multi-signature, permission update, other
    TronGrid only reports total / bandwidth / energy fee per tx; the rest is attributed from the tx (note, signature
    count, contract type, new-account transfer) using the network's current fee parameters
  - **totals**: energy and bandwidth used, failed txs, TRX and USDT in / out / net
  - **fees per day** (per week for ranges over 120 days) bar chart
  - **filters**: one chip per tx type with counts (trx transfer, account create, trc20 transfer, contract call,
    stake, unstake, cancel unstakes, withdraw unstaked, delegate, undelegate, vote, claim rewards, permission update,
    …), direction, result, search (txid, address, note, your key labels);
    totals and the fee chart follow the filters
  - tokens using the USDT symbol from another contract are flagged and left out of USDT figures
  - if the active node is not TronGrid, the built-in TronGrid host of the network is used
- **Voting rewards**: the vote tab shows unclaimed rewards and a *claim* button (WithdrawBalance, once per 24 h).

## Notes, signing and multisig

Every transaction form has:

- **note**: a memo stored on chain in `raw_data.data` (UTF-8). The network charges a memo fee (shown next to the field,
  `getMemoFee`, 1 TRX on Shasta/mainnet at the time of writing).
- **signing** (collapsed by default):
  - *permission id*: `0` owner, `2+` active permissions.
  - *signers*: which keys sign (`keys.json` or vault). **Empty = automatic**: the app reads the account's permission
    on chain and uses the keys it holds that belong to it (own key first, then heavier keys) until the threshold is
    reached. So if you moved an account's owner to another key you hold, just send as usual: the signing line shows
    e.g. `auto: #2 TUjAye… (owner 1/1)`. If you hold only some of a multisig's keys, it signs with those and keeps the
    tx pending. The account itself can be watch-only.
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

**API keys** can be sent as a header (default `TRON-PRO-API-KEY`, TronGrid style; header name is configurable) or
in the URL (`API key in: url`): appended as `<full host>/<key>` (GetBlock, Chainstack, …) or placed wherever `{key}`
appears in the full host, e.g. `https://rpc.ankr.com/premium-http/tron/{key}`.

**Rate limits**: public TronGrid mainnet without a key allows ~3 requests/s and suspends the caller for 5 s when
exceeded. All requests go through a per-node queue: keyless TronGrid mainnet is paced to one request every 400 ms,
keyless TronGrid testnets 3 in parallel, everything else 8 in parallel. On HTTP 429/403/503 the node's queue
pauses for the time the server asks for and the request is retried (up to 4 times). The app shows a notice when
you are on keyless mainnet TronGrid; get a free key at trongrid.io and add it under *nodes* (or set
`TRONGRID_API_KEY`).

## Permissions: operations bitmask

Active permissions have an `operations` field: a 32-byte hex mask of allowed contract types. In the Permissions tab you
build it with checkboxes (grouped, with presets like *Transfers only* or *Stake & vote*). You can also paste raw hex,
and the checkboxes update. Bit `N % 8` of byte `N / 8` enables contract type id `N`.

## Config (env vars)

| Var | Purpose |
|---|---|
| `KEYS_FILE` | Path to a keys file other than `./keys.json` |
| `VAULT_FILE` | Path to a vault file other than `vault.json` next to the keys file |
| `CACHE_FILE` | Path to the history cache other than `cache.sqlite` next to the keys file |
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
- `src/main/estimate.ts`: fee / bandwidth / energy estimate
- `src/main/history.ts`: TronGrid v1 history pages, item processing (types, fee causes), tx receipts
- `src/main/historyCache.ts`: SQLite history cache and sync
- `src/main/multisig.ts`: signing pipeline (note, expiration, signer checks, weight, broadcast) and sign-tx tools
- `src/main/client.ts`: TronWeb client for the active node / network
- `src/main/vault.ts`: encrypted vault, HD derivation, key import/export
- `src/main/nodes.ts`: node list, selection, API keys, connection test
- `src/shared/operations.ts`: operations bitmask encode/decode + contract type list
- `src/renderer/src/`: React UI
