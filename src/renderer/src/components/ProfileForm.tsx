import { useState } from 'react'
import { useInvalidateProfiles } from '../query/profiles'
import type { ConnectionProfile, SqliteProfile, SshOptions } from '@shared/adapter/types'
import { parseConnectionUrl } from '@shared/connection-url'
import { connectionLabel } from '@shared/connection-label'
import { parseMongoUri, buildMongoUriFromFields } from '@shared/mongo/uri'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'

function newId(): string {
  return `p-${Date.now().toString(36)}-${Math.floor(performance.now()).toString(36)}`
}

export function ProfileForm(props: {
  profile?: ConnectionProfile
  onSaved: () => void
  onCancel: () => void
}): React.JSX.Element {
  const p = props.profile
  // Postgres-only view of the edited profile, used to seed the PG field state.
  const pg = p?.engine === 'postgres' ? p : undefined
  // MongoDB-only view of the edited profile, used to seed the Mongo field state.
  const mongo = p?.engine === 'mongodb' ? p : undefined
  const [engine, setEngine] = useState<'postgres' | 'sqlite' | 'mongodb'>(
    p?.engine === 'sqlite' ? 'sqlite' : p?.engine === 'mongodb' ? 'mongodb' : 'postgres'
  )
  const [kind, setKind] = useState<'local' | 'remote' | 'replica'>(
    p?.engine === 'sqlite' ? p.kind : 'local'
  )
  const [file, setFile] = useState(p?.engine === 'sqlite' && 'file' in p ? p.file : '')
  const [url, setUrl] = useState(p?.engine === 'sqlite' && p.kind === 'remote' ? p.url : '')
  const [syncUrl, setSyncUrl] = useState(
    p?.engine === 'sqlite' && p.kind === 'replica' ? p.syncUrl : ''
  )
  const [authToken, setAuthToken] = useState('')
  const [name, setName] = useState(p?.name ?? '')
  const [environment, setEnvironment] = useState<'none' | 'production' | 'staging' | 'local'>(
    p?.environment ?? 'none'
  )
  const [favorite, setFavorite] = useState(p?.favorite ?? false)
  const [host, setHost] = useState(pg?.host ?? 'localhost')
  const [port, setPort] = useState(String(pg?.port ?? 5432))
  const [database, setDatabase] = useState(pg?.database ?? '')
  const [user, setUser] = useState(pg?.user ?? '')
  const [password, setPassword] = useState('')

  // SSL — minimal "trust server certificate" toggle for M2.
  const [useSsl, setUseSsl] = useState(pg?.ssl != null)
  const [verifyCert, setVerifyCert] = useState(pg?.ssl?.rejectUnauthorized ?? true)

  // SSH tunnel sub-form — collapsed by default.
  const [useSsh, setUseSsh] = useState(pg?.ssh != null)
  const [sshHost, setSshHost] = useState(pg?.ssh?.host ?? '')
  const [sshPort, setSshPort] = useState(String(pg?.ssh?.port ?? 22))
  const [sshUser, setSshUser] = useState(pg?.ssh?.user ?? '')
  const [authMethod, setAuthMethod] = useState<SshOptions['authMethod']>(
    pg?.ssh?.authMethod ?? 'password'
  )
  const [sshPassword, setSshPassword] = useState('')
  const [privateKeyPath, setPrivateKeyPath] = useState(pg?.ssh?.privateKeyPath ?? '')
  const [sshPassphrase, setSshPassphrase] = useState('')

  // Mongo — URI path (primary) is the default unless editing a profile that
  // was saved with discrete fields (recognizable by a persisted `host`).
  const [mongoSrv, setMongoSrv] = useState(false)
  // Editing an existing profile: seed the URI view from the saved discrete
  // fields (the secret credentials aren't re-shown — same as password fields).
  const [mongoUri, setMongoUri] = useState(() =>
    mongo?.host
      ? buildMongoUriFromFields({
          srv: false,
          host: mongo.host,
          port: mongo.port ?? 27017,
          user: mongo.user ?? '',
          password: '',
          database: mongo.database ?? '',
          authSource: mongo.authSource ?? '',
          tls: mongo.tls ?? false
        })
      : ''
  )
  const [mongoHost, setMongoHost] = useState(mongo?.host ?? 'localhost')
  const [mongoPort, setMongoPort] = useState(String(mongo?.port ?? 27017))
  const [mongoUser, setMongoUser] = useState(mongo?.user ?? '')
  const [mongoPassword, setMongoPassword] = useState('')
  const [mongoAuthSource, setMongoAuthSource] = useState(mongo?.authSource ?? '')
  const [mongoTls, setMongoTls] = useState(mongo?.tls ?? false)
  const [mongoDatabase, setMongoDatabase] = useState(mongo?.database ?? '')

  const [testMsg, setTestMsg] = useState('')
  const invalidateProfiles = useInvalidateProfiles()

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
      // Clear the pasted URL once consumed so the (cleartext) password from the
      // DSN isn't left sitting in a plain text field.
      setConnUrl('')
    } catch {
      setUrlError("Couldn't parse that URL")
      setExtraParams({}) // don't leave a prior parse's params next to an error
    }
  }

  // Compass-style two-way sync: the URI and the discrete fields describe the
  // same connection; editing either updates the other (URI wins on parse).
  function syncUriFromFields(next: {
    host?: string
    port?: string
    user?: string
    password?: string
    authSource?: string
    tls?: boolean
    database?: string
    srv?: boolean
  }): void {
    const srv = next.srv ?? mongoSrv
    const portNum = Number(next.port ?? mongoPort)
    setMongoUri(
      buildMongoUriFromFields({
        srv,
        host: next.host ?? mongoHost,
        port: srv ? null : Number.isInteger(portNum) && portNum > 0 ? portNum : 27017,
        user: next.user ?? mongoUser,
        password: next.password ?? mongoPassword,
        database: next.database ?? mongoDatabase,
        authSource: next.authSource ?? mongoAuthSource,
        tls: next.tls ?? mongoTls
      })
    )
  }
  function syncFieldsFromUri(uri: string): void {
    setMongoUri(uri)
    const f = parseMongoUri(uri)
    if (!f) return // keep typing; fields update on the next parseable state
    setMongoSrv(f.srv)
    setMongoHost(f.host)
    setMongoPort(f.port == null ? '' : String(f.port))
    setMongoUser(f.user)
    setMongoPassword(f.password)
    setMongoDatabase(f.database)
    setMongoAuthSource(f.authSource)
    setMongoTls(f.tls)
  }

  function build(): ConnectionProfile {
    // Non-secret Dialect metadata, shared by every engine branch below.
    const meta = {
      environment: environment === 'none' ? undefined : environment,
      favorite: favorite || undefined
    }
    if (engine === 'sqlite') {
      const id = p?.id ?? newId()
      let base: SqliteProfile
      if (kind === 'remote') base = { id, name, engine: 'sqlite', kind: 'remote', url }
      else if (kind === 'replica')
        base = { id, name, engine: 'sqlite', kind: 'replica', file, syncUrl }
      else base = { id, name, engine: 'sqlite', kind: 'local', file }
      return { ...base, ...meta, name: name.trim() || connectionLabel(base) }
    }
    if (engine === 'mongodb') {
      const parsedMongoPort = Number(mongoPort)
      const id = p?.id ?? newId()
      // Discrete fields persist (non-secret, drive card labels/search); the
      // URI travels as a secret and wins at connect time.
      const base: ConnectionProfile = {
        id,
        name,
        engine: 'mongodb',
        host: mongoHost || undefined,
        port: Number.isNaN(parsedMongoPort) ? 27017 : parsedMongoPort,
        user: mongoUser || undefined,
        authSource: mongoAuthSource || undefined,
        tls: mongoTls || undefined,
        database: mongoDatabase || undefined
      }
      return { ...base, ...meta, name: name.trim() || connectionLabel(base) }
    }
    const parsedPort = Number(port)
    const parsedSshPort = Number(sshPort)
    const base: ConnectionProfile = {
      id: p?.id ?? newId(),
      name,
      engine: 'postgres',
      host,
      port: Number.isNaN(parsedPort) ? 5432 : parsedPort,
      database,
      user,
      ssl: useSsl ? { rejectUnauthorized: verifyCert } : undefined,
      ssh: useSsh
        ? {
            host: sshHost,
            port: Number.isNaN(parsedSshPort) ? 22 : parsedSshPort,
            user: sshUser,
            authMethod,
            privateKeyPath: authMethod === 'key' ? privateKeyPath : undefined
          }
        : undefined
    }
    // Never persist a blank name — derive one so the sidebar row isn't empty.
    return { ...base, ...meta, name: name.trim() || connectionLabel(base) }
  }

  function secrets(): {
    password?: string
    sshPassword?: string
    sshPassphrase?: string
    authToken?: string
    uri?: string
  } {
    if (engine === 'sqlite')
      return kind === 'remote' || kind === 'replica' ? { authToken: authToken || undefined } : {}
    if (engine === 'mongodb')
      // The URI (may embed credentials) is the connect-time secret; the
      // password field is its synced view. Send both; hydrate prefers uri.
      return { uri: mongoUri || undefined, password: mongoPassword || undefined }
    return {
      password: password || undefined,
      sshPassword: useSsh && authMethod === 'password' ? sshPassword || undefined : undefined,
      sshPassphrase: useSsh && authMethod === 'key' ? sshPassphrase || undefined : undefined
    }
  }

  /** Dialect form action: persist, then verify liveness. Save always sticks
   *  (the profile is usable even if the test fails); a failing test keeps the
   *  panel open with the error so the user can fix and retry. */
  async function testAndSave(): Promise<void> {
    const profile = build()
    await window.fordb.profiles.save(profile, secrets())
    invalidateProfiles()
    setTestMsg('testing…')
    const r = await window.fordb.connection.test(profile.id)
    if (r.ok) {
      setTestMsg('')
      props.onSaved()
    } else {
      setTestMsg(r.error ?? 'Connection test failed')
    }
  }

  return (
    <div className="flex flex-col gap-2 p-4 max-w-md">
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground-2">
          Engine
        </div>
        <div role="radiogroup" aria-label="Database engine" className="flex flex-wrap gap-2">
          {(
            [
              ['postgres', 'Pg', 'PostgreSQL', 'bg-primary'],
              ['sqlite', 'Sq', 'SQLite', 'bg-info'],
              ['mongodb', 'Mo', 'MongoDB', 'bg-success']
            ] as const
          ).map(([id, glyph, label, cls]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={engine === id}
              aria-label={label}
              title={label}
              onClick={() => setEngine(id)}
              className={`inline-flex h-11 w-11 items-center justify-center rounded-[10px] text-xs font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cls} ${
                engine === id
                  ? 'ring-2 ring-primary ring-offset-2 ring-offset-card'
                  : 'opacity-70 hover:opacity-100'
              }`}
            >
              {glyph}
            </button>
          ))}
        </div>
      </div>
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <div>
        <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground-2">
          Environment
        </div>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Environment"
            className="flex flex-1 rounded-lg bg-surface-2 p-0.5"
          >
            {(['production', 'staging', 'local'] as const).map((env) => (
              <button
                key={env}
                type="button"
                role="radio"
                aria-checked={environment === env}
                onClick={() => setEnvironment(environment === env ? 'none' : env)}
                className={`flex-1 rounded-md px-2 py-1 text-xs capitalize focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  environment === env
                    ? 'bg-card font-semibold text-primary shadow-[var(--shadow-raised)]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {env}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(e) => setFavorite(e.target.checked)}
            />
            Favorite
          </label>
        </div>
      </div>
      {engine === 'sqlite' && (
        <>
          <Label>
            Kind
            <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
              <SelectTrigger aria-label="SQLite kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local file</SelectItem>
                <SelectItem value="remote">Remote</SelectItem>
                <SelectItem value="replica">Embedded replica</SelectItem>
              </SelectContent>
            </Select>
          </Label>
          {(kind === 'local' || kind === 'replica') && (
            <div className="flex gap-2">
              <Input
                className="flex-1"
                placeholder="File"
                value={file}
                onChange={(e) => setFile(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void window.fordb.dialog.openFile().then((f) => f && setFile(f))}
              >
                Browse…
              </Button>
            </div>
          )}
          {kind === 'remote' && (
            <Input
              placeholder="libsql:// URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
          {kind === 'replica' && (
            <Input
              placeholder="Sync URL"
              value={syncUrl}
              onChange={(e) => setSyncUrl(e.target.value)}
            />
          )}
          {(kind === 'remote' || kind === 'replica') && (
            <Input
              type="password"
              placeholder="Auth token"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
            />
          )}
        </>
      )}
      {engine === 'postgres' && (
        <>
          <div className="flex flex-col gap-1 pb-2 mb-2 border-b border-border">
            <Label htmlFor="conn-url">Paste connection URL</Label>
            <div className="flex gap-2">
              <Input
                id="conn-url"
                className="flex-1"
                placeholder="postgres://user:pass@host:5432/db?sslmode=require"
                value={connUrl}
                onChange={(e) => setConnUrl(e.target.value)}
                onBlur={fillFromUrl}
              />
              <Button type="button" variant="outline" onClick={fillFromUrl}>
                Fill from URL
              </Button>
            </div>
            {urlError && <div className="text-sm text-destructive">{urlError}</div>}
            {Object.keys(extraParams).length > 0 && (
              <div className="text-sm text-muted-foreground">
                Extra parameters (not applied yet):{' '}
                {Object.entries(extraParams)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ')}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              className="flex-[2]"
              placeholder="Host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
            />
            <Input
              className="flex-1"
              type="number"
              placeholder="Port"
              value={port}
              onChange={(e) => setPort(e.target.value)}
            />
          </div>
          <Input
            placeholder="Database"
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
          />
          <Input placeholder="User" value={user} onChange={(e) => setUser(e.target.value)} />
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Label className="mt-2">
            <Checkbox checked={useSsl} onCheckedChange={(v) => setUseSsl(v === true)} />
            Use SSL
          </Label>
          {useSsl && (
            <Label className="pl-6">
              <Checkbox checked={verifyCert} onCheckedChange={(v) => setVerifyCert(v === true)} />
              Verify server certificate
            </Label>
          )}

          <Label className="mt-2">
            <Checkbox checked={useSsh} onCheckedChange={(v) => setUseSsh(v === true)} />
            Use SSH tunnel
          </Label>
          {useSsh && (
            <div className="flex flex-col gap-2 pl-6 border-l border-border">
              <Input
                placeholder="SSH host"
                value={sshHost}
                onChange={(e) => setSshHost(e.target.value)}
              />
              <Input
                type="number"
                placeholder="SSH port"
                value={sshPort}
                onChange={(e) => setSshPort(e.target.value)}
              />
              <Input
                placeholder="SSH user"
                value={sshUser}
                onChange={(e) => setSshUser(e.target.value)}
              />
              <Select
                value={authMethod}
                onValueChange={(v) => setAuthMethod(v as SshOptions['authMethod'])}
              >
                <SelectTrigger aria-label="SSH authentication method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">Password</SelectItem>
                  <SelectItem value="key">Private key</SelectItem>
                  <SelectItem value="agent">SSH agent</SelectItem>
                </SelectContent>
              </Select>
              {authMethod === 'password' && (
                <Input
                  type="password"
                  placeholder="SSH password"
                  value={sshPassword}
                  onChange={(e) => setSshPassword(e.target.value)}
                />
              )}
              {authMethod === 'key' && (
                <>
                  <Input
                    placeholder="Private key path"
                    value={privateKeyPath}
                    onChange={(e) => setPrivateKeyPath(e.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder="Key passphrase (optional)"
                    value={sshPassphrase}
                    onChange={(e) => setSshPassphrase(e.target.value)}
                  />
                </>
              )}
            </div>
          )}
        </>
      )}
      {engine === 'mongodb' && (
        <>
          {/* Compass-style: URI and fields are two views of one connection —
              editing either syncs the other. */}
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground-2">
              URI
            </div>
            <textarea
              aria-label="Connection URI"
              rows={2}
              spellCheck={false}
              className="w-full resize-y rounded border border-border bg-background px-2 py-1 font-mono text-xs"
              placeholder="mongodb://user:pass@host:27017/db"
              value={mongoUri}
              onChange={(e) => syncFieldsFromUri(e.target.value)}
            />
          </div>
          <div className="flex rounded-lg bg-surface-2 p-0.5" role="radiogroup" aria-label="Scheme">
            {(
              [
                ['mongodb', false],
                ['mongodb+srv', true]
              ] as const
            ).map(([label, srv]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={mongoSrv === srv}
                onClick={() => {
                  setMongoSrv(srv)
                  syncUriFromFields({ srv })
                }}
                className={`flex-1 rounded-md px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  mongoSrv === srv
                    ? 'bg-card font-semibold text-primary shadow-[var(--shadow-raised)]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              className="flex-[2]"
              placeholder="Host"
              value={mongoHost}
              onChange={(e) => {
                setMongoHost(e.target.value)
                syncUriFromFields({ host: e.target.value })
              }}
            />
            {!mongoSrv && (
              <Input
                className="flex-1"
                type="number"
                placeholder="Port"
                value={mongoPort}
                onChange={(e) => {
                  setMongoPort(e.target.value)
                  syncUriFromFields({ port: e.target.value })
                }}
              />
            )}
          </div>
          <div className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="User"
              value={mongoUser}
              onChange={(e) => {
                setMongoUser(e.target.value)
                syncUriFromFields({ user: e.target.value })
              }}
            />
            <Input
              className="flex-1"
              type="password"
              placeholder="Password"
              value={mongoPassword}
              onChange={(e) => {
                setMongoPassword(e.target.value)
                syncUriFromFields({ password: e.target.value })
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="Auth source"
              value={mongoAuthSource}
              onChange={(e) => {
                setMongoAuthSource(e.target.value)
                syncUriFromFields({ authSource: e.target.value })
              }}
            />
            <Label>
              <Checkbox
                checked={mongoTls}
                onCheckedChange={(v) => {
                  setMongoTls(v === true)
                  syncUriFromFields({ tls: v === true })
                }}
              />
              TLS
            </Label>
          </div>
          <Input
            placeholder="Database (optional)"
            value={mongoDatabase}
            onChange={(e) => {
              setMongoDatabase(e.target.value)
              syncUriFromFields({ database: e.target.value })
            }}
          />
        </>
      )}

      <div className="flex gap-2 mt-2">
        <Button variant="outline" className="flex-1" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={() => void testAndSave()}>
          Test & Save
        </Button>
      </div>
      {testMsg && (
        <div
          className={`text-sm ${testMsg === 'OK' ? 'text-primary' : testMsg.startsWith('Error') ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {testMsg}
        </div>
      )}
    </div>
  )
}
