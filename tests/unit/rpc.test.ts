import { describe, it, expect } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { createRpcClient } from '../../src/shared/rpc/client'
import { serveRpc } from '../../src/shared/rpc/server'
import type { PortLike } from '../../src/shared/rpc/protocol'

function nodePort(port: import('node:worker_threads').MessagePort): PortLike {
  return {
    postMessage: (msg) => port.postMessage(msg),
    onMessage: (cb) => port.on('message', cb),
    onClose: (cb) => port.on('close', cb)
  }
}

interface Calculator {
  add(a: number, b: number): Promise<number>
  fail(): Promise<void>
  failWithCode(): Promise<void>
  hang(): Promise<void>
}

const impl: Calculator = {
  add: (a, b) => Promise.resolve(a + b),
  fail: () => Promise.reject(new Error('boom: ECODE')),
  failWithCode: () => Promise.reject(Object.assign(new Error('bad'), { code: '42601' })),
  hang: () => new Promise(() => {})
}

function setup(): { client: Calculator; teardown: () => void } {
  const { port1, port2 } = new MessageChannel()
  serveRpc(nodePort(port1), impl)
  const client = createRpcClient<Calculator>(nodePort(port2))
  return { client, teardown: () => (port1.close(), port2.close()) }
}

describe('rpc', () => {
  it('round-trips a method call with args and result', async () => {
    const { client, teardown } = setup()
    await expect(client.add(2, 3)).resolves.toBe(5)
    teardown()
  })

  it('propagates errors with original message', async () => {
    const { client, teardown } = setup()
    await expect(client.fail()).rejects.toThrow('boom: ECODE')
    teardown()
  })

  it('rejects unknown methods', async () => {
    const { client, teardown } = setup()
    await expect((client as unknown as { nope: () => Promise<void> }).nope()).rejects.toThrow(
      /unknown method/i
    )
    teardown()
  })

  it('keeps concurrent calls correlated', async () => {
    const { client, teardown } = setup()
    const results = await Promise.all([client.add(1, 1), client.add(2, 2), client.add(3, 3)])
    expect(results).toEqual([2, 4, 6])
    teardown()
  })

  it('rejects in-flight calls when the port closes', async () => {
    const { port1, port2 } = new MessageChannel()
    serveRpc(nodePort(port1), impl)
    const client = createRpcClient<Calculator>(nodePort(port2))

    const pending = client.hang()
    port2.close()
    await expect(pending).rejects.toThrow(/port closed/i)

    port1.close()
  })

  it('round-trips a structured error with a code', async () => {
    const { client, teardown } = setup()
    await expect(client.failWithCode()).rejects.toMatchObject({
      message: 'bad',
      code: '42601'
    })
    teardown()
  })
})
