import { test, expect } from 'claude-code/testing'
import { parseAssumptions, buildCorrection } from './register'

test('zerlegt die Fork-Antwort in Annahmen', () => {
  const r = parseAssumptions('1. Port 3000 genommen\n- Port 3000 genommen\n\n* Annahme 2: Ordner src\nKEINE')
  expect(r).toEqual(['Port 3000 genommen', 'Ordner src'])
})

test('KEINE ergibt eine leere Liste', () => {
  expect(parseAssumptions('KEINE')).toEqual([])
})

test('baut den Korrektur-Auftrag nur mit falschen', () => {
  expect(buildCorrection([{ text: 'a', mark: 'richtig' }], '')).toBe('')
  const t = buildCorrection(
    [
      { text: 'Port 3000', mark: 'falsch' },
      { text: 'Ordner src', mark: 'richtig' },
      { text: 'egal', mark: 'offen' },
    ],
    'nimm 8080',
  )
  expect(t).toContain('- Port 3000')
  expect(t).toContain('behalte sie:\n- Ordner src')
  expect(t).toContain('Hinweis von mir: nimm 8080')
  expect(t).not.toContain('egal')
})

test('Band: Fork-Annahmen zeigen, falsch markieren, Korrektur senden', async ($, on) => {
  let submitted = ''
  on('model.fork', async () => ({ value: {
    isAnswered: true,
    text: '1. Port 3000 genommen\n2. Ordner src',
    usage: { input_tokens: 1, output_tokens: 1 },
  } }) as never)
  on('ui.render', async ($r, e) => {
    const { Box } = $r.ui.resolve(e)
    return <Box key="engine" />
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('prompt.submit', async (_$, e) => {
    submitted = e.text
    return { text: e.text }
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    submitted = ''
    await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 't-' + surface })
    const ui = await $.ui.mount({ plugin: 'annahmen', surface, component: 'AbovePrompt', props: {} as never })
    expect(await ui.find({ type: 'Text', text: /2 Annahmen/ })).toBeDefined()
    await ui.press({ key: 'open' })
    expect(await ui.find({ key: 'send' })).toBeUndefined()
    await ui.press({ key: 'no-0' })
    await ui.press({ key: 'ok-1' })
    await ui.press({ key: 'send' })
    expect(submitted).toContain('- Port 3000 genommen')
    expect(submitted).toContain('behalte sie:\n- Ordner src')
    expect(await ui.find({ key: 'open' })).toBeUndefined()
    await ui.unmount()
  }
})
