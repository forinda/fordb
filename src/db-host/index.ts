process.parentPort.on('message', (e) => {
  const [port] = e.ports
  if (!port) return
  port.on('message', (msg) => {
    if ((msg.data as { type?: string }).type === 'ping') {
      port.postMessage({ type: 'pong' })
    }
  })
  port.start()
})
