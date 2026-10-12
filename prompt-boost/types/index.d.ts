declare module 'claude-code' {
  interface PluginState {
    'prompt-boost': {
      hasDraft: boolean
      busy: boolean
      original: string
      enabled: boolean
      editSeen: boolean
    }
  }
}
