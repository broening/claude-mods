import { test, expect, mock } from 'claude-code/testing'
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

// Ein Ersatz fuer next-steps: an, und beim fertigen Zug schreibt er "shared"
// so, wie der echte Mod es mit seinem gemeinsamen Fork tut.
const fakeNextSteps = {
  name: 'next-steps',
  register: ((on: any) => {
    on('session.start', async ($: any, e: any, next: any) => {
      await $.state.set({ plugin: 'next-steps', key: 'enabled' }, true)
      return next(e)
    })
    on('turn.complete', async ($: any, e: any, next: any) => {
      const ref = { plugin: 'next-steps', key: 'shared' }
      await $.state.set(ref, { gen: 1, loading: true, assumptions: [] })
      await $.state.set(ref, { gen: 1, loading: false, assumptions: ['Aus dem gemeinsamen Fork'] })
      return next(e)
    })
  }) as never,
}

test('nutzt den Fork von next-steps und fragt nicht selbst', { plugins: [fakeNextSteps] }, async ($, on) => {
  let ownForks = 0
  on('model.fork', async () => {
    ownForks++
    return { value: { isAnswered: true, text: 'Eigene Annahme', usage: { input_tokens: 1, output_tokens: 1 } } } as never
  })
  on('ui.render', async ($r, e) => {
    const { Box } = $r.ui.resolve(e)
    return <Box key="engine" />
  })
  on('turn.complete', async () => ({ text: '' }))
  on('session.start', async (_$, e) => ({ ...e, cwd: '/' }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  mock.store(on)
  await $.session.start({ source: 'startup', cwd: '/' } as never)
  await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'annahmen', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
  expect(ownForks).toBe(0)
  expect(await ui.find({ type: 'Text', text: /1 Annahme/ })).toBeDefined()
  await ui.press({ key: 'open' })
  expect(await ui.find({ type: 'Text', text: /gemeinsamen Fork/ })).toBeDefined()
  await ui.unmount()
})
