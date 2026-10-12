import { test, expect } from 'claude-code/testing'
import { buildForkPrompt, cleanRewrite } from './register'

test('saeubert die Antwort', () => {
  expect(cleanRewrite('```markdown\nBau X mit /web-craft\n```')).toBe('Bau X mit /web-craft')
  expect(cleanRewrite('Verbesserter Prompt:\nBau X')).toBe('Bau X')
  expect(cleanRewrite('  Bau X  ')).toBe('Bau X')
})

test('der Fork-Auftrag enthaelt den Entwurf', () => {
  const p = buildForkPrompt('mach die seite schoen')
  expect(p).toContain('<<<\nmach die seite schoen\n>>>')
  expect(p).toContain('NICHT')
})

// Ablauf im Band: tippen -> Knopf -> Entwurf ersetzt, nichts gesendet -> rueckgaengig.
test('Band: verbessern ersetzt den Entwurf und rueckgaengig holt ihn zurueck', async ($, on) => {
  let box = ''
  let sent = 0
  let forkPrompt = ''
    on('prompt.edit', async (_$, e) => {
      box = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
      return { text: box, cursor: box.length }
    })
    on('prompt.read', async () => ({ value: { text: box, cursor: box.length } }) as never)
    on('prompt.fill', async (_$, e) => {
      box = e.text
      return { isFilled: true } as never
    })
    on('prompt.submit', async (_$, e) => {
      sent++
      return { text: e.text }
    })
    on('model.fork', async (_$, e: any) => {
      forkPrompt = e.prompt
      return { value: { isAnswered: true, text: 'Baue X. Nutze /web-craft.', usage: { input_tokens: 1, output_tokens: 1 } } } as never
    })
    on('ui.toast', async () => ({ value: undefined }) as never)
    on('ui.render', async ($r, e) => {
      const { Box } = $r.ui.resolve(e)
      return <Box key="engine" />
    })

  for (const surface of ['terminal', 'desktop'] as const) {
    box = ''
    const ui = await $.ui.mount({ plugin: 'prompt-boost', surface, component: 'AbovePrompt', props: {} as never })
    // Vor dem ersten Tippen: Fallback zeigt den Knopf; danach nur mit Entwurf.
    if (surface === 'desktop') expect(await ui.find({ key: 'boost' })).toBeUndefined()
    await ($.prompt as unknown as { edit: (e: unknown) => Promise<unknown> }).edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'mach x' } as never)
    expect(await ui.find({ key: 'boost' })).toBeDefined()
    await ui.press({ key: 'boost' })
    expect(forkPrompt).toContain('mach x')
    expect(box).toBe('Baue X. Nutze /web-craft.')
    expect(sent).toBe(0)
    await ui.press({ key: 'undo' })
    expect(box).toBe('mach x')
    expect(await ui.find({ key: 'undo' })).toBeUndefined()
    // Absenden leert das Band wieder (fuer die naechste Oberflaeche).
    await $.prompt.submit({ text: box } as never)
    sent = 0
    expect(await ui.find({ key: 'boost' })).toBeUndefined()
    await ui.unmount()
  }
})

test('ohne Tipp-Meldungen steht der Knopf da und fasst ein leeres Feld nicht an', async ($, on) => {
  let fills = 0
  let toasts: string[] = []
  on('prompt.read', async () => ({ value: { text: '', cursor: 0 } }) as never)
  on('prompt.fill', async () => {
    fills++
    return { isFilled: true } as never
  })
  on('ui.toast', async (_$, e: any) => {
    toasts.push(String(e.text))
    return { value: undefined } as never
  })
  on('ui.render', async ($r, e) => {
    const { Box } = $r.ui.resolve(e)
    return <Box key="engine" />
  })
  const ui = await $.ui.mount({ plugin: 'prompt-boost', surface: 'desktop', component: 'AbovePrompt', props: {} as never })
  expect(await ui.find({ key: 'boost' })).toBeDefined()
  await ui.press({ key: 'boost' })
  expect(fills).toBe(0)
  expect(toasts.join(' ')).toContain('Entwurf')
  await ui.unmount()
})
