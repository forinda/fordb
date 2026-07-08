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

export function createRpcClient<T extends object>(port: PortLike): T {
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  port.onMessage((msg) => {
    if (!isRpcResponse(msg)) return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok) entry.resolve(msg.value)
    else entry.reject(toError(msg.error))
  })

  port.onClose?.(() => {
    for (const entry of pending.values()) {
      entry.reject(new Error('RPC port closed'))
    }
    pending.clear()
  })

  return new Proxy({} as T, {
    get(_t, method: string) {
      return (...args: unknown[]): Promise<unknown> =>
        new Promise((resolve, reject) => {
          const id = nextId++
          pending.set(id, { resolve, reject })
          const req: RpcRequest = { kind: 'rpc-request', id, method, args }
          port.postMessage(req)
        })
    }
  })
}
