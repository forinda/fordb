import { describe, it, expect } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { createRpcClient } from '../../src/shared/rpc/client'
import { serveRpc } from '../../src/shared/rpc/server'
import type { PortLike } from '../../src/shared/rpc/protocol'

function nodePort(p: import('node:worker_threads').MessagePort): PortLike {
  return { postMessage: (m) => p.postMessage(m), onMessage: (cb) => p.on('message', cb) }
}
interface Api {
  echo(x: number): Promise<number>
  never(): Promise<void>
}
const impl = { echo: (x: number) => Promise.resolve(x), never: () => new Promise<void>(() => {}) }

describe('rpc timeout', () => {
  it('rejects a call that never gets a response', async () => {
    const { port1, port2 } = new MessageChannel()
    serveRpc(nodePort(port1), impl)
    const client = createRpcClient<Api>(nodePort(port2), { timeoutMs: 100 })
    await expect(client.never()).rejects.toThrow(/timeout/i)
    port1.close()
    port2.close()
  })
  it('a timely call resolves before the timeout', async () => {
    const { port1, port2 } = new MessageChannel()
    serveRpc(nodePort(port1), impl)
    const client = createRpcClient<Api>(nodePort(port2), { timeoutMs: 1000 })
    await expect(client.echo(7)).resolves.toBe(7)
    port1.close()
    port2.close()
  })
})
