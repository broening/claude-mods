declare module 'claude-code' {
  interface PluginState {
    'cache-countdown': {
      lastActivity: number
      tick: number
      autoCompact: boolean
    }
  }
}
