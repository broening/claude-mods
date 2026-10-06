export type Frage = {
  frage: string
  optionen: string[]
  vorschlag: string
}

declare module 'claude-code' {
  interface PluginState {
    'grill': {
      fragen: Frage[]
      antworten: (string | null)[]
      index: number
      aktiv: boolean
      laden: boolean
      draft: string
    }
  }
}
