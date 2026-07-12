// src/shared/ai/conversation-types.ts

/** One tool invocation shown in the transcript. No result payload is persisted —
 *  only the one-line summary the agent already surfaces. */
export interface Step {
  id: string
  name: string
  args: string
  gated: boolean
  destructive?: boolean
  status: 'pending' | 'ran' | 'denied' | 'error'
  summary?: string
}

export interface Turn {
  role: 'user' | 'assistant'
  text: string
  steps: Step[]
}

export interface Conversation {
  id: string
  title: string
  updatedAt: number
  turns: Turn[]
}

export interface ConversationSummary {
  id: string
  title: string
  updatedAt: number
}
