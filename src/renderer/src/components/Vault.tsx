import { useEffect, useState } from 'react'
import type { MnemonicInfo, PublicKey, VaultStatus } from '../../../shared/types'
import { Field, short } from '../ui'

// ---------- small building blocks ----------

export function Modal({ title, onClose, children, danger, wide }: {
  title: string
  onClose?: () => void
  children: React.ReactNode
  danger?: boolean
  wide?: boolean
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal ${wide ? 'vault-modal' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className={`modal-head ${danger ? 'danger-head' : ''}`}>
          <span>{title}</span>
          {onClose && (
            <button className="close" onClick={onClose} aria-label="Close">
              esc
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

function useEsc(fn?: () => void) {
  useEffect(() => {
    if (!fn) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fn])
}

/** Asks for the vault password, runs `action` with it, shows errors inline. */
export function PasswordModal({ title, confirmLabel, onClose, action }: {
  title: string
  confirmLabel: string
  onClose: () => void
  action: (pw: string) => Promise<void>
}) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEsc(onClose)
  const submit = async () => {
    setBusy(true)
    setErr(undefined)
    try {
      await action(pw)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
        <Field label="vault password">
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>cancel</button>
          <button className="primary" disabled={!pw || busy}>{busy ? 'working…' : confirmLabel}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Shows a secret once with copy, until the user dismisses it. */
export function SecretModal({ title, secret, note, onClose }: { title: string; secret: string; note?: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  useEsc(onClose)
  const words = secret.includes(' ') ? secret.split(' ') : null
  return (
    <Modal title={title} onClose={onClose} danger>
      <div className="form">
        {note && <div className="warn">{note}</div>}
        {words ? (
          <ol className="seed">
            {words.map((w, i) => (
              <li key={i}><span className="muted">{String(i + 1).padStart(2, '0')}</span> {w}</li>
            ))}
          </ol>
        ) : (
          <pre className="secret">{secret}</pre>
        )}
        <div className="actions">
          <button
            className="ghost"
            onClick={() => {
              navigator.clipboard.writeText(secret)
              setCopied(true)
            }}
          >
            {copied ? 'copied' : 'copy'}
          </button>
          <button className="primary" onClick={onClose}>done</button>
        </div>
      </div>
    </Modal>
  )
}

// ---------- sidebar status bar ----------

export function VaultBar({ status, onOpen }: { status?: VaultStatus; onOpen: (m: 'create' | 'unlock' | 'manage') => void }) {
  if (!status) return null
  const state = !status.exists ? 'none' : status.unlocked ? 'open' : 'locked'
  return (
    <div className={`vault-bar ${state}`}>
      <span>
        <span className="muted">vault </span>
        {state}
      </span>
      <span className="vault-actions">
        {state === 'none' && <button className="link" onClick={() => onOpen('create')}>create</button>}
        {state === 'locked' && <button className="link" onClick={() => onOpen('unlock')}>unlock</button>}
        {state === 'open' && (
          <>
            <button className="link" onClick={() => onOpen('manage')}>+ addresses</button>
            <button className="link" onClick={() => window.api.vaultLock()}>lock</button>
          </>
        )}
      </span>
    </div>
  )
}

// ---------- create / unlock ----------

export function CreateVaultModal({ path, onClose }: { path: string; onClose: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [err, setErr] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEsc(onClose)
  const mismatch = pw2 !== '' && pw !== pw2
  const submit = async () => {
    setBusy(true)
    setErr(undefined)
    try {
      await window.api.vaultCreate(pw)
      onClose()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="create vault" onClose={onClose}>
      <form className="form" onSubmit={(e) => (e.preventDefault(), submit())}>
        <p className="muted">
          Encrypted with scrypt + AES-256-GCM and saved to <span className="mono">{path}</span>. There is no way to
          recover it without the password.
        </p>
        <Field label="password (min 8 characters)">
          <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <Field label="repeat password">
          <input type="password" className={mismatch ? 'invalid' : ''} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        {err && <div className="error">{err}</div>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>cancel</button>
          <button className="primary" disabled={pw.length < 8 || pw !== pw2 || busy}>{busy ? 'creating…' : 'create vault'}</button>
        </div>
      </form>
    </Modal>
  )
}

export function UnlockModal({ onClose }: { onClose: () => void }) {
  return (
    <PasswordModal
      title="unlock vault"
      confirmLabel="unlock"
      onClose={onClose}
      action={async (pw) => {
        await window.api.vaultUnlock(pw)
        onClose()
      }}
    />
  )
}

// ---------- manage: seeds, keys, settings ----------

type Section = 'hd' | 'keys' | 'settings'

export function VaultModal({ status, onClose, onCreated }: {
  status: VaultStatus
  onClose: () => void
  onCreated: (keys: PublicKey[]) => void
}) {
  const [section, setSection] = useState<Section>('hd')
  const [secret, setSecret] = useState<{ title: string; secret: string; note?: string }>()
  useEsc(secret ? undefined : onClose)
  return (
    <>
      <Modal title="vault" onClose={onClose} wide>
        <nav className="tabs">
          {(['hd', 'keys', 'settings'] as Section[]).map((s) => (
            <button key={s} className={s === section ? 'on' : ''} onClick={() => setSection(s)}>
              {s === 'hd' ? 'hd seeds' : s === 'keys' ? 'single keys' : 'settings'}
            </button>
          ))}
        </nav>
        {section === 'hd' && <HdSection onCreated={onCreated} showSecret={setSecret} />}
        {section === 'keys' && <KeysSection onCreated={onCreated} />}
        {section === 'settings' && <SettingsSection status={status} />}
      </Modal>
      {secret && <SecretModal {...secret} onClose={() => setSecret(undefined)} />}
    </>
  )
}

function Result({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <div className="error">{err}</div>
  if (ok) return <div className="ok">{ok}</div>
  return null
}

function HdSection({ onCreated, showSecret }: {
  onCreated: (k: PublicKey[]) => void
  showSecret: (s: { title: string; secret: string; note?: string }) => void
}) {
  const [seeds, setSeeds] = useState<MnemonicInfo[]>([])
  const [count, setCount] = useState<Record<string, string>>({})
  const [mode, setMode] = useState<'none' | 'new' | 'import'>('none')
  const [name, setName] = useState('')
  const [words, setWords] = useState<12 | 24>(12)
  const [phrase, setPhrase] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [reveal, setReveal] = useState<string>()
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})

  const load = () => window.api.listMnemonics().then(setSeeds).catch((e) => setMsg({ err: e.message }))
  useEffect(() => {
    load()
  }, [])

  const run = async (fn: () => Promise<void>) => {
    setMsg({})
    try {
      await fn()
    } catch (e: any) {
      setMsg({ err: e.message })
    }
  }

  const resetForm = () => {
    setMode('none')
    setName('')
    setPhrase('')
    setPassphrase('')
  }

  return (
    <div className="form wide-form">
      <p className="muted">
        BIP39 seeds. Addresses are derived at <span className="mono">m/44'/195'/0'/0/i</span>, the standard TRON path
        (TronLink, Ledger), so the same seed gives the same addresses in other wallets.
      </p>

      {seeds.length === 0 && mode === 'none' && <div className="muted">No seeds yet.</div>}
      {seeds.length > 0 && (
        <table className="nodes">
          <thead>
            <tr>
              <th>name</th>
              <th>words</th>
              <th>derived</th>
              <th>next index</th>
              <th>derive</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {seeds.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.name} {s.hasPassphrase && <span className="muted">+passphrase</span>}
                </td>
                <td>{s.words}</td>
                <td>{s.derived}</td>
                <td className="mono">/{s.nextIndex}</td>
                <td className="nowrap">
                  <input
                    className="count"
                    value={count[s.id] ?? '1'}
                    onChange={(e) => setCount((c) => ({ ...c, [s.id]: e.target.value.replace(/[^0-9]/g, '') }))}
                  />{' '}
                  <button
                    className="small-btn"
                    onClick={() =>
                      run(async () => {
                        const n = Math.max(1, Number(count[s.id] ?? '1') || 1)
                        const created = await window.api.deriveNext(s.id, n)
                        onCreated(created)
                        setMsg({ ok: `derived ${created.map((k) => `#${k.id} ${short(k.address)}`).join(', ')}` })
                        load()
                      })
                    }
                  >
                    derive next
                  </button>
                </td>
                <td>
                  <button className="link" onClick={() => setReveal(s.id)}>show phrase</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Result {...msg} />

      {mode === 'none' && (
        <div className="row">
          <button onClick={() => setMode('new')}>+ new seed</button>
          <button className="ghost" onClick={() => setMode('import')}>import seed</button>
        </div>
      )}

      {mode !== 'none' && (
        <div className="card form">
          <b>{mode === 'new' ? 'new seed' : 'import seed'}</b>
          <div className="row">
            <Field label="name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="multisig-test" />
            </Field>
            {mode === 'new' && (
              <Field label="words">
                <select value={words} onChange={(e) => setWords(Number(e.target.value) as 12 | 24)}>
                  <option value={12}>12</option>
                  <option value={24}>24</option>
                </select>
              </Field>
            )}
          </div>
          {mode === 'import' && (
            <Field label="mnemonic phrase">
              <textarea rows={3} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="word1 word2 …" />
            </Field>
          )}
          <Field label="bip39 passphrase (optional, changes all addresses)">
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </Field>
          <div className="row">
            <button
              className="primary"
              disabled={mode === 'import' && !phrase.trim()}
              onClick={() =>
                run(async () => {
                  if (mode === 'new') {
                    const r = await window.api.createMnemonic(name, words, passphrase || undefined)
                    showSecret({
                      title: 'new seed: write it down',
                      secret: r.phrase,
                      note: 'This phrase controls every address derived from it. It is stored in the vault, but keep an offline copy.'
                    })
                  } else {
                    await window.api.importMnemonic(name, phrase, passphrase || undefined)
                    setMsg({ ok: 'seed imported' })
                  }
                  resetForm()
                  load()
                })
              }
            >
              {mode === 'new' ? 'generate' : 'import'}
            </button>
            <button className="ghost" onClick={resetForm}>cancel</button>
          </div>
        </div>
      )}

      {reveal && (
        <PasswordModal
          title="show seed phrase"
          confirmLabel="show"
          onClose={() => setReveal(undefined)}
          action={async (pw) => {
            const r = await window.api.revealMnemonic(reveal, pw)
            setReveal(undefined)
            showSecret({
              title: 'seed phrase',
              secret: r.phrase,
              note: r.passphrase ? 'This seed also uses a BIP39 passphrase (not shown).' : undefined
            })
          }}
        />
      )}
    </div>
  )
}

function KeysSection({ onCreated }: { onCreated: (k: PublicKey[]) => void }) {
  const [label, setLabel] = useState('')
  const [pk, setPk] = useState('')
  const [watch, setWatch] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})

  const run = async (fn: () => Promise<PublicKey>, after: () => void) => {
    setMsg({})
    try {
      const k = await fn()
      onCreated([k])
      setMsg({ ok: `added #${k.id} ${k.address}` })
      after()
    } catch (e: any) {
      setMsg({ err: e.message })
    }
  }

  return (
    <div className="form wide-form">
      <Field label="label (used for the next key you add)">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" style={{ maxWidth: 320 }} />
      </Field>

      <div className="card form">
        <b>random key</b>
        <p className="muted">A fresh private key, not tied to any seed.</p>
        <button className="primary" onClick={() => run(() => window.api.createRandomKey(label), () => setLabel(''))}>
          generate
        </button>
      </div>

      <div className="card form">
        <b>import private key</b>
        <input type="password" className="mono" value={pk} onChange={(e) => setPk(e.target.value)} placeholder="64 hex characters" />
        <button
          className="primary"
          disabled={!pk.trim()}
          onClick={() => run(() => window.api.importPrivateKey(label, pk), () => (setPk(''), setLabel('')))}
        >
          import
        </button>
      </div>

      <div className="card form">
        <b>watch-only address</b>
        <p className="muted">Track balances of an address you don't hold the key for (e.g. a multisig co-signer).</p>
        <input className="mono" value={watch} onChange={(e) => setWatch(e.target.value.trim())} placeholder="T…" />
        <button
          className="primary"
          disabled={!watch}
          onClick={() => run(() => window.api.addWatchOnly(label, watch), () => (setWatch(''), setLabel('')))}
        >
          add
        </button>
      </div>

      <Result {...msg} />
    </div>
  )
}

function SettingsSection({ status }: { status: VaultStatus }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const run = async (fn: () => Promise<string>) => {
    setMsg({})
    try {
      setMsg({ ok: await fn() })
    } catch (e: any) {
      setMsg({ err: e.message })
    }
  }
  return (
    <div className="form wide-form">
      <dl className="kv single">
        <div className="kv-row"><dt>file</dt><dd className="mono">{status.path}</dd></div>
        <div className="kv-row"><dt>encryption</dt><dd>scrypt (N=2^17) + AES-256-GCM</dd></div>
        <div className="kv-row"><dt>auto-lock</dt><dd>after {status.autoLockMinutes} min of inactivity</dd></div>
      </dl>

      <div className="card form">
        <b>import keys.json</b>
        <p className="muted">Copies every keys.json entry into the vault as an imported key. keys.json stays as it is.</p>
        <button
          onClick={() =>
            run(async () => {
              const r = await window.api.importKeysFile()
              return `added ${r.added}, skipped ${r.skipped} (already in vault or address mismatch)`
            })
          }
        >
          import keys.json
        </button>
      </div>

      <div className="card form">
        <b>change password</b>
        <div className="row">
          <Field label="current password">
            <input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
          </Field>
          <Field label="new password (min 8)">
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
          </Field>
          <button
            disabled={!oldPw || newPw.length < 8}
            onClick={() =>
              run(async () => {
                await window.api.vaultChangePassword(oldPw, newPw)
                setOldPw('')
                setNewPw('')
                return 'password changed'
              })
            }
          >
            change
          </button>
        </div>
      </div>
      <Result {...msg} />
    </div>
  )
}
