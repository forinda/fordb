export interface PortLike {
  postMessage(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): void
}

export interface RpcRequest {
  kind: 'rpc-request'
  id: number
  method: string
  args: unknown[]
}

export type RpcResponse =
  | { kind: 'rpc-response'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-response'; id: number; ok: false; error: string }

export function isRpcRequest(msg: unknown): msg is RpcRequest {
  return typeof msg === 'object' && msg !== null && (msg as RpcRequest).kind === 'rpc-request'
}

export function isRpcResponse(msg: unknown): msg is RpcResponse {
  return typeof msg === 'object' && msg !== null && (msg as RpcResponse).kind === 'rpc-response'
}
