import { useState } from 'react'
import { useConnStore } from '../store'
import type { ConnectionProfile, SshOptions } from '../../../shared/adapter/types'
import { parseConnectionUrl } from '../../../shared/connection-url'

function newId(): string {
  return `p-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`
}

export function ProfileForm(props: {
  profile?: ConnectionProfile
  onSaved: () => void
  onCancel: () => void
}): React.JSX.Element {
  const p = props.profile
  const [name, setName] = useState(p?.name ?? '')
  const [host, setHost] = useState(p?.host ?? 'localhost')
  const [port, setPort] = useState(String(p?.port ?? 5432))
  const [database, setDatabase] = useState(p?.database ?? '')
  const [user, setUser] = useState(p?.user ?? '')
  const [password, setPassword] = useState('')

  // SSL — minimal "trust server certificate" toggle for M2.
  const [useSsl, setUseSsl] = useState(p?.ssl != null)
  const [verifyCert, setVerifyCert] = useState(p?.ssl?.rejectUnauthorized ?? true)

  // SSH tunnel sub-form — collapsed by default.
  const [useSsh, setUseSsh] = useState(p?.ssh != null)
  const [sshHost, setSshHost] = useState(p?.ssh?.host ?? '')
  const [sshPort, setSshPort] = useState(String(p?.ssh?.port ?? 22))
  const [sshUser, setSshUser] = useState(p?.ssh?.user ?? '')
  const [authMethod, setAuthMethod] = useState<SshOptions['authMethod']>(
    p?.ssh?.authMethod ?? 'password'
  )
  const [sshPassword, setSshPassword] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState(p?.ssh?.privateKeyPath ?? '')
  const [sshPassphrase, setSshPassphrase] = useState('')

  const [testMsg, setTestMsg] = useState('')

  // Paste-a-URL import — DataGrip-style. Parsing is pure and only fills the
  // form fields above; it never auto-submits.
  const [connUrl, setConnUrl] = useState('')
  const [urlError, setUrlError] = useState('')
  const [extraParams, setExtraParams] = useState<Record<string, string>>({})

  function fillFromUrl(): void {
    if (!connUrl.trim()) return
    try {
      const parsed = parseConnectionUrl(connUrl)
      setUrlError('')
      if (parsed.profile.host !== undefined) setHost(parsed.profile.host)
      if (parsed.profile.port !== undefined) setPort(String(parsed.profile.port))
      if (parsed.profile.database !== undefined) setDatabase(parsed.profile.database)
      if (parsed.profile.user !== undefined) setUser(parsed.profile.user)
      if (parsed.password !== undefined) setPassword(parsed.password)
      if (parsed.profile.ssl !== undefined) {
        setUseSsl(true)
        setVerifyCert(parsed.profile.ssl.rejectUnauthorized)
      }
      setExtraParams(parsed.extraParams)
    } catch {
      setUrlError("Couldn't parse that URL")
    }
  }

  function build(): ConnectionProfile {
    return {
      id: p?.id ?? newId(),
      name,
      engine: 'postgres',
      host,
      port: Number(port),
      database,
      user,
      ssl: useSsl ? { rejectUnauthorized: verifyCert } : undefined,
      ssh: useSsh
        ? {
            host: sshHost,
            port: Number(sshPort),
            user: sshUser,
            authMethod,
            privateKeyPath: authMethod === 'key' ? privateKeyPath : undefined
          }
        : undefined
    }
  }

  function secrets(): { password?: string; sshPassword?: string; sshPassphrase?: string } {
    return {
      password: password || undefined,
      sshPassword: useSsh && authMethod === 'password' ? sshPassword || undefined : undefined,
      sshPassphrase: useSsh && authMethod === 'key' ? sshPassphrase || undefined : undefined
    }
  }

  async function save(): Promise<void> {
    await window.fordb.profiles.save(build(), secrets())
    await useConnStore.getState().loadProfiles()
    props.onSaved()
  }
  async function test(): Promise<void> {
    setTestMsg('testing…')
    const profile = build()
    await window.fordb.profiles.save(profile, secrets())
    const r = await window.fordb.connection.test(profile.id)
    setTestMsg(r.ok ? 'OK' : `Error: ${r.error ?? 'failed'}`)
  }

  const field =
    'px-2 py-1 rounded bg-neutral-900 border border-neutral-600 text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-400'
  return (
    <div className="flex flex-col gap-2 p-4 max-w-md">
      <div className="flex flex-col gap-1 pb-2 mb-2 border-b border-neutral-700">
        <label className="text-sm text-neutral-300" htmlFor="conn-url">
          Paste connection URL
        </label>
        <div className="flex gap-2">
          <input
            id="conn-url"
            className={`${field} flex-1`}
            placeholder="postgres://user:pass@host:5432/db?sslmode=require"
            value={connUrl}
            onChange={(e) => setConnUrl(e.target.value)}
            onBlur={fillFromUrl}
          />
          <button
            type="button"
            className="px-3 py-1 rounded border border-neutral-500 text-neutral-100 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            onClick={fillFromUrl}
          >
            Fill from URL
          </button>
        </div>
        {urlError && <div className="text-sm text-red-400">{urlError}</div>}
        {Object.keys(extraParams).length > 0 && (
          <div className="text-sm text-neutral-400">
            Extra parameters (not applied yet):{' '}
            {Object.entries(extraParams)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}
          </div>
        )}
      </div>
      <input
        className={field}
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className={field}
        placeholder="Host"
        value={host}
        onChange={(e) => setHost(e.target.value)}
      />
      <input
        className={field}
        placeholder="Port"
        value={port}
        onChange={(e) => setPort(e.target.value)}
      />
      <input
        className={field}
        placeholder="Database"
        value={database}
        onChange={(e) => setDatabase(e.target.value)}
      />
      <input
        className={field}
        placeholder="User"
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />
      <input
        className={field}
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <label className="flex items-center gap-2 text-sm mt-2">
        <input type="checkbox" checked={useSsl} onChange={(e) => setUseSsl(e.target.checked)} />
        Use SSL
      </label>
      {useSsl && (
        <label className="flex items-center gap-2 text-sm pl-6">
          <input
            type="checkbox"
            checked={verifyCert}
            onChange={(e) => setVerifyCert(e.target.checked)}
          />
          Verify server certificate
        </label>
      )}

      <label className="flex items-center gap-2 text-sm mt-2">
        <input type="checkbox" checked={useSsh} onChange={(e) => setUseSsh(e.target.checked)} />
        Use SSH tunnel
      </label>
      {useSsh && (
        <div className="flex flex-col gap-2 pl-6 border-l border-neutral-800">
          <input
            className={field}
            placeholder="SSH host"
            value={sshHost}
            onChange={(e) => setSshHost(e.target.value)}
          />
          <input
            className={field}
            placeholder="SSH port"
            value={sshPort}
            onChange={(e) => setSshPort(e.target.value)}
          />
          <input
            className={field}
            placeholder="SSH user"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
          />
          <select
            className={field}
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as SshOptions['authMethod'])}
          >
            <option value="password">Password</option>
            <option value="key">Private key</option>
            <option value="agent">SSH agent</option>
          </select>
          {authMethod === 'password' && (
            <input
              className={field}
              type="password"
              placeholder="SSH password"
              value={sshPassword}
              onChange={(e) => setSshPassword(e.target.value)}
            />
          )}
          {authMethod === 'key' && (
            <>
              <input
                className={field}
                placeholder="Private key path"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
              />
              <input
                className={field}
                type="password"
                placeholder="Key passphrase (optional)"
                value={sshPassphrase}
                onChange={(e) => setSshPassphrase(e.target.value)}
              />
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          className="px-3 py-1 rounded bg-blue-700 text-white hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={() => void save()}
        >
          Save
        </button>
        <button
          className="px-3 py-1 rounded border border-neutral-500 text-neutral-100 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={() => void test()}
        >
          Test
        </button>
        <button
          className="px-3 py-1 rounded border border-neutral-700 text-neutral-300 hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={props.onCancel}
        >
          Cancel
        </button>
      </div>
      {testMsg && (
        <div
          className={`text-sm ${testMsg === 'OK' ? 'text-green-400' : testMsg.startsWith('Error') ? 'text-red-400' : 'text-neutral-300'}`}
        >
          {testMsg}
        </div>
      )}
    </div>
  )
}
