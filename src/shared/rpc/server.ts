import { isRpcRequest, type PortLike, type RpcResponse } from './protocol'

export function serveRpc(port: PortLike, target: object): void {
  port.onMessage((msg) => {
    if (!isRpcRequest(msg)) return
    const respond = (r: RpcResponse): void => port.postMessage(r)
    const fn = (target as Record<string, unknown>)[msg.method]
    if (typeof fn !== 'function') {
      respond({
        kind: 'rpc-response',
        id: msg.id,
        ok: false,
        error: `Unknown method: ${msg.method}`
      })
      return
    }
    void Promise.resolve()
      .then(() => (fn as (...a: unknown[]) => unknown).apply(target, msg.args))
      .then((value) => respond({ kind: 'rpc-response', id: msg.id, ok: true, value }))
      .catch((err: unknown) =>
        respond({
          kind: 'rpc-response',
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      )
  })
}
