declare module 'claude-code' {
  interface PluginState {
    'next-steps': {
      suggestions: string[]
      loading: boolean
      enabled: boolean
    }
  }
}
