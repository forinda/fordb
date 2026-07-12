// src/shared/ai/types.ts

/** Events streamed main → renderer during one agent turn. */
export type AiEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool-start'; id: string; name: string; args: string; gated: boolean }
  | { kind: 'tool-result'; id: string; ok: boolean; summary: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

/** Non-secret AI config surfaced to the renderer (never the key). */
export interface AiConfigPublic {
  baseUrl: string
  model: string
  hasKey: boolean
}
