import { isRpcResponse, type PortLike, type RpcRequest } from './protocol'

export function createRpcClient<T extends object>(port: PortLike): T {
  let nextId = 1
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  port.onMessage((msg) => {
    if (!isRpcResponse(msg)) return
    const entry = pending.get(msg.id)
    if (!entry) return
    pending.delete(msg.id)
    if (msg.ok) entry.resolve(msg.value)
    else entry.reject(new Error(msg.error))
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
