import { describe, it, expect } from 'vitest'
import { controlMode } from '../../src/shared/window-controls'

describe('controlMode', () => {
  it('uses native controls on macOS (hiddenInset traffic lights)', () => {
    expect(controlMode('darwin')).toBe('native')
  })
  it('uses custom controls on Linux and Windows', () => {
    expect(controlMode('linux')).toBe('custom')
    expect(controlMode('win32')).toBe('custom')
  })
})
