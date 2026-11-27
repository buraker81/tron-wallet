import { useState } from 'react'
import type { Balances, PublicKey, Resource } from '../../../shared/types'
import type { RunTx } from '../App'
import { Field, PermissionIdInput, fmt, toOpts } from '../ui'

interface Props {
  from: PublicKey
  keys: PublicKey[]
  balances?: Balances
  runTx: RunTx
  busy: boolean
}

export function Stake({ from, balances, runTx, busy }: Props) {
  const [amount, setAmount] = useState('')
  const [resource, setResource] = useState<Resource>('ENERGY')
  const [permId, setPermId] = useState('')
  const n = Number(amount)
  const now = Date.now()
  const withdrawable = (balances?.unfreezing ?? []).filter((u) => u.expireAt <= now).reduce((s, u) => s + u.amount, 0)

  return (
    <div className="form">
      <div className="muted small">Stake 2.0: staking gives you resources and Tron Power (1 TRX = 1 vote).</div>
      <Field label="Amount (TRX)">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
      </Field>
      <Field label="Resource">
        <select value={resource} onChange={(e) => setResource(e.target.value as Resource)}>
          <option value="ENERGY">ENERGY</option>
          <option value="BANDWIDTH">BANDWIDTH</option>
        </select>
      </Field>
      <PermissionIdInput value={permId} onChange={setPermId} />
      <div className="row">
        <button
          className="primary"
          disabled={!(n > 0) || busy}
          onClick={() =>
            runTx(`Stake ${amount} TRX for ${resource} #${from.id}`, () =>
              window.api.stake(from.id, n, resource, toOpts(permId))
            )
          }
        >
          Stake
        </button>
        <button
          disabled={!(n > 0) || busy}
          onClick={() =>
            runTx(`Unstake ${amount} TRX from ${resource} #${from.id}`, () =>
              window.api.unstake(from.id, n, resource, toOpts(permId))
            )
          }
        >
          Unstake
        </button>
        <button
          disabled={busy}
          onClick={() =>
            runTx(`Withdraw unstaked TRX #${from.id}`, () => window.api.withdrawUnfrozen(from.id, toOpts(permId)))
          }
        >
          Withdraw unstaked ({fmt(withdrawable)} TRX ready)
        </button>
      </div>
      <div className="muted small">Unstaked TRX becomes withdrawable after the unlock period (14 days on mainnet).</div>
    </div>
  )
}
