export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type ContextFill = { tokens?: number; window: number; percent?: number }

export type Snapshot = {
  dir: string | null
  model: string | null
  effort: string | null
  context: ContextFill | null
  rateLimits: RateLimit[]
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-status': { snapshot: Shaped<Snapshot> }
  }
}
