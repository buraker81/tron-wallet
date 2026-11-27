import { useEffect, useState } from 'react'
import type { Balances, PublicKey } from '../../../shared/types'
import type { RunTx } from '../App'
import { fmt, short } from '../ui'
import { Modal, PasswordModal, SecretModal } from './Vault'

const SOURCE_LABEL: Record<PublicKey['source'], string> = {
  file: 'keys.json',
  hd: 'hd',
  random: 'random',
  imported: 'imported',
  watch: 'watch-only'
}

export function AccountActions({ k, keys, balances, allBalances, runTx, busy }: {
  k: PublicKey
  keys: PublicKey[]
  balances?: Balances
  allBalances: Record<string, Balances>
  runTx: RunTx
  busy: boolean
}) {
  const inVault = k.source !== 'file'
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(k.label ?? '')
  const [reveal, setReveal] = useState(false)
  const [secret, setSecret] = useState<string>()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [err, setErr] = useState<string>()

  // activation funding
  const funders = keys.filter((x) => x.canSign && x.id !== k.id && (allBalances[x.address]?.trx ?? 0) > 1.1)
  const [fundFrom, setFundFrom] = useState<number>()
  const [fundAmount, setFundAmount] = useState('1')
  useEffect(() => {
    setLabel(k.label ?? '')
    setEditing(false)
    setErr(undefined)
  }, [k.id, k.label])
  useEffect(() => {
    if (!funders.some((f) => f.id === fundFrom)) setFundFrom(funders[0]?.id)
  }, [funders.map((f) => f.id).join(), fundFrom])

  const saveLabel = async () => {
    try {
      await window.api.renameKey(k.id, label)
      setEditing(false)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="account-actions">
      <div className="meta">
        <span className="tag">{SOURCE_LABEL[k.source]}</span>
        {k.hd && <span className="mono muted">{k.hd.path}</span>}
        {inVault &&
          (editing ? (
            <form className="inline-edit" onSubmit={(e) => (e.preventDefault(), saveLabel())}>
              <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} />
              <button className="link">save</button>
              <button type="button" className="link" onClick={() => setEditing(false)}>cancel</button>
            </form>
          ) : (
            <>
              <span>{k.label || <span className="muted">no label</span>}</span>
              <button className="link" onClick={() => setEditing(true)}>rename</button>
            </>
          ))}
        <span className="spacer" />
        {inVault && k.canSign && <button className="link" onClick={() => setReveal(true)}>show private key</button>}
        {inVault && <button className="link danger-link" onClick={() => setConfirmDelete(true)}>remove</button>}
      </div>
      {err && <div className="error">{err}</div>}

      {balances && !balances.activated && (
        <div className="activate">
          <span>Not activated yet. Fund it to create the account on chain:</span>
          {funders.length === 0 ? (
            <span className="muted">no funded key available</span>
          ) : (
            <span className="row">
              <span className="muted">send</span>
              <input className="count" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} />
              <span className="muted">trx from</span>
              <select value={fundFrom} onChange={(e) => setFundFrom(Number(e.target.value))}>
                {funders.map((f) => (
                  <option key={f.id} value={f.id}>
                    #{f.id} {f.label ? `${f.label} ` : ''}{short(f.address)} ({fmt(allBalances[f.address].trx, 1)} trx)
                  </option>
                ))}
              </select>
              <button
                className="primary"
                disabled={busy || !fundFrom || !(Number(fundAmount) > 0)}
                onClick={() =>
                  runTx(`Activate #${k.id}: send ${fundAmount} TRX #${fundFrom} → ${short(k.address)}`, () =>
                    window.api.sendTrx(fundFrom!, k.address, Number(fundAmount))
                  )
                }
              >
                fund
              </button>
            </span>
          )}
        </div>
      )}

      {reveal && (
        <PasswordModal
          title={`show private key #${k.id}`}
          confirmLabel="show"
          onClose={() => setReveal(false)}
          action={async (pw) => {
            setSecret(await window.api.revealPrivateKey(k.id, pw))
            setReveal(false)
          }}
        />
      )}
      {secret && (
        <SecretModal
          title={`private key #${k.id}`}
          secret={secret}
          note="Anyone with this key controls the address."
          onClose={() => setSecret(undefined)}
        />
      )}
      {confirmDelete && (
        <Modal title={`remove #${k.id} from vault`} onClose={() => setConfirmDelete(false)} danger>
          <div className="form">
            <p>
              <span className="mono">{k.address}</span> will be removed from the vault.
              {k.source === 'hd'
                ? ' Its seed stays in the vault, so the key itself is not lost.'
                : k.source === 'watch'
                  ? ''
                  : ' Its private key is lost unless you have a copy.'}
            </p>
            <div className="actions">
              <button className="ghost" onClick={() => setConfirmDelete(false)}>cancel</button>
              <button
                className="danger"
                onClick={async () => {
                  try {
                    await window.api.deleteKey(k.id)
                  } catch (e: any) {
                    setErr(e.message)
                  }
                  setConfirmDelete(false)
                }}
              >
                remove
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
