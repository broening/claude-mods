declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      suggestions: string[]
      loading: boolean
      enabled: boolean
      shared: { gen: number; loading: boolean; assumptions: string[] }
    }
  }
}
