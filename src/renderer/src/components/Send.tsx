import { useState } from 'react'
import type { PublicKey } from '../../../shared/types'
import type { RunTx } from '../App'
import { AddressInput, Field, PermissionIdInput, short, toOpts } from '../ui'

interface Props {
  from: PublicKey
  keys: PublicKey[]
  runTx: RunTx
  busy: boolean
}

function SendForm({ from, keys, runTx, busy, token }: Props & { token: 'TRX' | 'USDT' }) {
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [permId, setPermId] = useState('')
  const valid = to.startsWith('T') && to.length === 34 && Number(amount) > 0

  const submit = () => {
    const n = Number(amount)
    const label = `Send ${amount} ${token} #${from.id} → ${short(to)}`
    runTx(label, () =>
      token === 'TRX'
        ? window.api.sendTrx(from.id, to, n, toOpts(permId))
        : window.api.sendUsdt(from.id, to, n, toOpts(permId))
    )
  }

  return (
    <div className="form">
      <Field label="To">
        <AddressInput value={to} onChange={setTo} keys={keys} exclude={from.address} />
      </Field>
      <Field label={`Amount (${token})`}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
      </Field>
      <PermissionIdInput value={permId} onChange={setPermId} />
      {token === 'USDT' && <div className="muted small">Fee limit: 100 TRX. Uses the network's USDT contract.</div>}
      <button className="primary" disabled={!valid || busy} onClick={submit}>
        {busy ? 'Sending…' : `Send ${token}`}
      </button>
    </div>
  )
}

export const SendTrx = (p: Props) => <SendForm {...p} token="TRX" />
export const SendUsdt = (p: Props) => <SendForm {...p} token="USDT" />
