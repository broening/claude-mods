export type Other = { id: string; start: number }

declare module 'claude-code' {
  interface PluginState {
    'sitzungs-waechter': {
      // Andere lebende Sitzungen im selben Ordner.
      others: Other[]
      // Schluessel der Liste, die der Nutzer mit "ok" weggeklickt hat.
      dismissed: string
    }
  }
}
