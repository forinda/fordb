// src/main/ai/config.ts
import type { SettingsStore } from '../settings-store'
import type { SecretStore } from '../secret-store'
import type { AiConfigPublic } from '@shared/ai/types'

/** Reserved SecretStore id for the AI endpoint key (keychain, never plaintext). */
export const AI_KEY_ID = '__ai__'

export async function getAiConfig(
  settings: SettingsStore,
  secrets: SecretStore
): Promise<{ baseUrl: string; model: string; apiKey: string; allowWrites: boolean }> {
  const { baseUrl, model, allowWrites } = await settings.getAi()
  const apiKey = (await secrets.get(AI_KEY_ID)).authToken ?? ''
  return { baseUrl, model, apiKey, allowWrites }
}

export async function getAiConfigPublic(
  settings: SettingsStore,
  secrets: SecretStore
): Promise<AiConfigPublic> {
  const c = await getAiConfig(settings, secrets)
  return { baseUrl: c.baseUrl, model: c.model, hasKey: c.apiKey !== '', allowWrites: c.allowWrites }
}
