export interface PortLike {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): void
  // Best-effort notification that the underlying transport closed. Not every
  // transport can signal this reliably (see preload's browser MessagePort
  // implementation), so it is optional.
  onClose?(cb: () => void): void
}

export interface RpcRequest {
  kind: 'rpc-request'
  id: number
  method: string
  args: unknown[]
}

export interface RpcError {
  message: string
  code?: string
  detail?: string
  hint?: string
  position?: string
  stack?: string
}

export type RpcResponse =
  | { kind: 'rpc-response'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-response'; id: number; ok: false; error: RpcError }

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  return typeof msg === 'object' && msg !== null && (msg as RpcRequest).kind === 'rpc-request'
}

export function isRpcResponse(msg: unknown): msg is RpcResponse {
  return typeof msg === 'object' && msg !== null && (msg as RpcResponse).kind === 'rpc-response'
}
