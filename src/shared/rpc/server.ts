import { isRpcRequest, type PortLike, type RpcError, type RpcResponse } from './protocol'

function toRpcError(err: unknown): RpcError {
  if (!(err instanceof Error)) {
    return { message: String(err) }
  }
  const rpcError: RpcError = { message: err.message }
  const props = err as unknown as Record<string, unknown>
  if (typeof props.code === 'string') rpcError.code = props.code
  if (typeof props.detail === 'string') rpcError.detail = props.detail
  if (typeof props.hint === 'string') rpcError.hint = props.hint
  if (typeof props.position === 'string') rpcError.position = props.position
  if (typeof err.stack === 'string') rpcError.stack = err.stack
  return rpcError
}

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
        error: { message: `Unknown method: ${msg.method}` }
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
          error: toRpcError(err)
        })
      )
  })
}
