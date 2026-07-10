import { useState } from 'react'
import { useInvalidateProfiles } from '../query/profiles'
import type { ConnectionProfile, SqliteProfile, SshOptions } from '@shared/adapter/types'
import { parseConnectionUrl } from '@shared/connection-url'
import { connectionLabel } from '@shared/connection-label'
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
  // MongoDB profiles aren't editable in this form yet (M7); default to postgres
  // rather than widen this form's engine union for a profile it can't render.
  const [engine, setEngine] = useState<'postgres' | 'sqlite'>(
    p?.engine === 'sqlite' ? 'sqlite' : 'postgres'
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

  function build(): ConnectionProfile {
    if (engine === 'sqlite') {
      const id = p?.id ?? newId()
      let base: SqliteProfile
      if (kind === 'remote') base = { id, name, engine: 'sqlite', kind: 'remote', url }
      else if (kind === 'replica')
        base = { id, name, engine: 'sqlite', kind: 'replica', file, syncUrl }
      else base = { id, name, engine: 'sqlite', kind: 'local', file }
      return { ...base, name: name.trim() || connectionLabel(base) }
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
    return { ...base, name: name.trim() || connectionLabel(base) }
  }

  function secrets(): {
    password?: string
    sshPassword?: string
    sshPassphrase?: string
    authToken?: string
  } {
    if (engine === 'sqlite')
      return kind === 'remote' || kind === 'replica' ? { authToken: authToken || undefined } : {}
    return {
      password: password || undefined,
      sshPassword: useSsh && authMethod === 'password' ? sshPassword || undefined : undefined,
      sshPassphrase: useSsh && authMethod === 'key' ? sshPassphrase || undefined : undefined
    }
  }

  async function save(): Promise<void> {
    await window.fordb.profiles.save(build(), secrets())
    invalidateProfiles()
    props.onSaved()
  }
  async function test(): Promise<void> {
    setTestMsg('testing…')
    const profile = build()
    await window.fordb.profiles.save(profile, secrets())
    const r = await window.fordb.connection.test(profile.id)
    setTestMsg(r.ok ? 'OK' : `Error: ${r.error ?? 'failed'}`)
  }

  return (
    <div className="flex flex-col gap-2 p-4 max-w-md">
      <Label>
        Engine
        <Select value={engine} onValueChange={(v) => setEngine(v as 'postgres' | 'sqlite')}>
          <SelectTrigger aria-label="Database engine">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="postgres">PostgreSQL</SelectItem>
            <SelectItem value="sqlite">SQLite</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
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
          <Input placeholder="Host" value={host} onChange={(e) => setHost(e.target.value)} />
          <Input
            type="number"
            placeholder="Port"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
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

      <div className="flex gap-2 mt-2">
        <Button onClick={() => void save()}>Save</Button>
        <Button variant="outline" onClick={() => void test()}>
          Test
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
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
