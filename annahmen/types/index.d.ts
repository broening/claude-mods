export type Mark = 'offen' | 'richtig' | 'falsch'
export interface Assumption {
  text: string
  mark: Mark
}

declare module 'claude-code' {
  interface PluginState {
    annahmen: {
      items: Assumption[]
      expanded: boolean
      loading: boolean
      enabled: boolean
      note: string
      pending: number
    }
  }
}
