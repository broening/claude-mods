import { test, expect } from 'claude-code/testing'
import { parseFork } from './register'

test('teilt die Fork-Antwort in Schritte und Annahmen', () => {
  const r = parseFork(
    '**SCHRITTE:**\n1. Tests laufen lassen\n- Commit machen\nREADME anpassen\nZu viel\nANNAHMEN:\n- Port 3000 genommen\nAnnahme 2: Ordner src',
  )
  expect(r.steps).toEqual(['Tests laufen lassen', 'Commit machen', 'README anpassen'])
  expect(r.assumptions).toEqual(['Port 3000 genommen', 'Ordner src'])
})

test('KEINE Annahmen und alte Form ohne Ueberschriften', () => {
  expect(parseFork('SCHRITTE:\na\nb\nc\nANNAHMEN:\nKEINE').assumptions).toEqual([])
  expect(parseFork('a\nb\nc')).toEqual({ steps: ['a', 'b', 'c'], assumptions: [] })
})

test('ein Fork fuellt Vorschlaege und die Annahmen fuer annahmen', async ($, on) => {
  let forks = 0
  on('model.fork', async () => {
    forks++
    return {
      value: {
        isAnswered: true,
        text: 'SCHRITTE:\nTests laufen lassen\nCommit\nPush\nANNAHMEN:\nPort 3000',
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('turn.complete', async () => ({ text: '' }))
  on('ui.render', async ($r, e) => {
    const { Box } = $r.ui.resolve(e)
    return <Box key="engine" />
  })
  await $.turn.complete({ reason: 'answer', answer: 'x', durationMs: 1, isAborted: false, turnId: 't1' })
  const ui = await $.ui.mount({ plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
  expect(await ui.find({ key: 'pick-0' })).toBeDefined()
  expect(forks).toBe(1)
  await ui.unmount()
})
