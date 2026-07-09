import { isRpcResponse, type PortLike, type RpcError, type RpcRequest } from './protocol'

function toError(rpcError: RpcError): Error {
  const err = new Error(rpcError.message)
  if (rpcError.code !== undefined) Object.assign(err, { code: rpcError.code })
  if (rpcError.detail !== undefined) Object.assign(err, { detail: rpcError.detail })
  if (rpcError.hint !== undefined) Object.assign(err, { hint: rpcError.hint })
  if (rpcError.position !== undefined) Object.assign(err, { position: rpcError.position })
  if (rpcError.stack !== undefined) err.stack = rpcError.stack
  return err
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

export function createRpcClient<T extends object>(
  port: PortLike,
  opts?: { timeoutMs?: number }
): T {
  let nextId = 1
  const pending = new Map<number, Pending>()

  function settle(id: number): Pending | undefined {
    const entry = pending.get(id)
    if (entry) {
      pending.delete(id)
      if (entry.timer) clearTimeout(entry.timer)
    }
    return entry
  }

  port.onMessage((msg) => {
    if (!isRpcResponse(msg)) return
    const entry = settle(msg.id)
    if (!entry) return
    if (msg.ok) entry.resolve(msg.value)
    else entry.reject(toError(msg.error))
  })

  port.onClose?.(() => {
    for (const [id, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer)
      entry.reject(new Error('RPC port closed'))
      pending.delete(id)
    }
  })

  return new Proxy({} as T, {
    get(_t, prop): unknown {
      // The client is routinely awaited (`await hostApi()`), and Promise
      // adoption probes `.then` on the resolved value. Without this guard the
      // Proxy would answer `get('then')` with a function, look thenable, and
      // the machinery would call `.then(resolve, reject)` — sending those
      // FUNCTIONS over postMessage, which throws "could not be cloned". Symbol
      // keys and the promise methods are never real RPC methods, so refuse them.
      if (typeof prop !== 'string' || prop === 'then' || prop === 'catch' || prop === 'finally')
        return undefined
      const method = prop
      return (...args: unknown[]): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const id = nextId++
          const entry: Pending = { resolve, reject }
          if (opts?.timeoutMs !== undefined) {
            entry.timer = setTimeout(() => {
              if (settle(id)) reject(new Error(`RPC timeout after ${opts.timeoutMs}ms`))
            }, opts.timeoutMs)
          }
          pending.set(id, entry)
          const req: RpcRequest = { kind: 'rpc-request', id, method, args }
          port.postMessage(req)
        })
    }
  })
}
