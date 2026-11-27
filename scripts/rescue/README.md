# rescue: move a leaked account away from a sweeper bot

Standalone script (not part of the app). Plain TronWeb, Node 20+.

A sweeper bot holds the private key of **victim** and drains every deposit as soon as it sees it in a block.
The victim has no TRX, so it cannot pay the 100 TRX `AccountPermissionUpdate` fee itself. The script sends:

| | from | what |
|---|---|---|
| **TX1** | funder | fee + 2 TRX to the victim |
| **TX2** | victim | `AccountPermissionUpdate`: owner, **all** active permissions (and witness, if SR) → new owner |

The goal is **TX1 and TX2 in the same block, TX2 after TX1**. The bot reacts to blocks, so when it sees the
deposit, the leaked key can no longer sign for the victim and its sweep fails.

## How it gets both into one block

1. All reads (accounts, fees, head block) happen first. Then both txs are **built locally** on a shared reference
   block (TronWeb with an explicit `blockHeader`: no node call and no balance check, so TX2 can be built while
   the victim is still empty) and **signed**.
2. It waits for a **new block** (start of the ~3 s window), broadcasts TX1 and, as soon as the node accepted it,
   TX2, to the **same node**. The node validates TX2 on top of its pending state, which already holds TX1.
   If TX2 comes back with "balance not sufficient" it is retried for ~200 ms.
3. It waits for both receipts and prints whether they are in the same block, their order in it, and the victim's
   owner/active keys afterwards.

TX2 can never land *before* TX1 (without the deposit it is invalid), so the only failure mode is TX1 and TX2
ending up in **different** blocks.

## Requirements

- **One fixed full node.** Your own java-tron node is best, or a provider endpoint that pins a single node.
  Public TronGrid is load balanced: TX1 and TX2 can reach different nodes, and then TX2 is rejected because
  that node has not seen TX1 yet. The script warns when the node is TronGrid.
- **New owner** must be a clean, freshly generated key (not derived from anything that leaked).
- **Funder** needs the amount plus ~1.1 TRX if the victim was never activated, plus a little bandwidth.
- Permissions are replaced completely: the leaked key keeps no owner, active or witness rights.

## Usage

```bash
# keys from env (do not pass private keys as arguments: shell history)
export RESCUE_FUNDER_PK=...    # account that pays
export RESCUE_VICTIM_PK=...    # leaked key

# 1) dry run: reads, builds, signs, checks. Sends nothing.
node scripts/rescue/rescue.mjs --node http://127.0.0.1:8090 --new-owner T...AYSE

# 2) fire
node scripts/rescue/rescue.mjs --node http://127.0.0.1:8090 --new-owner T...AYSE --fire
node scripts/rescue/rescue.mjs --node http://127.0.0.1:8090 --new-owner T...AYSE --fire --yes-mainnet   # mainnet
```

Keys can also come from a keys.json file: `--keys keys.json --funder 1 --victim 3`.

| option | default | |
|---|---|---|
| `--node <url>` | `RESCUE_NODE` | full node HTTP API |
| `--new-owner <address>` | `RESCUE_NEW_OWNER` | becomes owner + active (+ witness) |
| `--api-key <k>` | `RESCUE_API_KEY` | `--api-key-in header\|url`, `--api-key-header <name>` |
| `--amount <trx>` | fee + 2 | TRX sent in TX1 |
| `--expire-min <n>` | 15 | lifetime of both txs (2–1440) |
| `--ref-depth <n>` | 20 | reference block = head − n |
| `--extra-node <url>` | | also send both here after the primary accepted them (repeatable) |
| `--no-wait-block` | | fire immediately instead of at the start of a new block |
| `--fire` | | broadcast (default is a dry run) |
| `--yes-mainnet` | | required with `--fire` on mainnet |
| `RESCUE_ACTIVE_OPS` | all ops except permission update | operations mask of the new active permission |

Exit codes: `0` permissions moved, `1` aborted before sending, `2` TX1 sent but TX2 rejected (the signed TX2 is
printed: re-broadcast it immediately), `3` both mined but the victim's permissions are not what was expected.

## Rehearse first

Run the whole thing on Shasta or Nile with throwaway accounts (faucet: https://shasta.tronex.io) a few times and
check how often it reports `SAME BLOCK`.

## Limits

- If the bot also watches the **mempool** (not just blocks), it can see TX1 before it is mined and race it.
- If TX1 and TX2 straddle a block boundary they land in different blocks and the bot gets ~3 s. Waiting for a new
  block before firing (the default) minimises this.
- If the bot changes the victim's permissions first, it is too late: the dry run checks that the leaked key still
  controls the owner permission.

## Verified

On Shasta, txs built and signed offline (unreachable host configured) pass the node's signature and TAPOS checks
and are rejected only by contract validation when the accounts are empty; a corrupted reference block gives
`TAPOS_ERROR`. The full same-block run needs funded accounts and has not been run from here.
