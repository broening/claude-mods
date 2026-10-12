import { test, expect, mock } from 'claude-code/testing'
import { merge, normDir, othersIn, parseRegistry } from './register'

test('Ordner werden gleich geschrieben', () => {
  expect(normDir('C:\\Users\\Danie\\Projekt\\')).toBe('c:/users/danie/projekt')
  expect(normDir('c:/users/danie/projekt')).toBe('c:/users/danie/projekt')
})

test('tote Eintraege fliegen raus, andere im selben Ordner werden gefunden', () => {
  const reg = parseRegistry(
    JSON.stringify({
      sessions: {
        alt: { dir: 'c:/p', ts: 0, start: 0 },
        nachbar: { dir: 'c:/p', ts: 100_000, start: 5 },
        fremd: { dir: 'c:/q', ts: 100_000, start: 1 },
      },
    }),
  )
  const now = 110_000
  const next = merge(reg, 'ich', { dir: 'c:/p', ts: now, start: 9 }, now)
  expect(Object.keys(next.sessions).sort()).toEqual(['fremd', 'ich', 'nachbar'])
  expect(othersIn(next, 'ich', 'c:/p', now)).toEqual([{ id: 'nachbar', start: 5 }])
  expect(Object.keys(merge(next, 'ich', undefined, now).sessions)).not.toContain('ich')
  expect(parseRegistry('kaputt')).toEqual({ sessions: {} })
})

test('Band warnt bei zweiter Sitzung, ok blendet aus', async ($, on) => {
  let file = JSON.stringify({ sessions: { nachbar: { dir: 'c:/p', ts: 1_000, start: 1 } } })
  let toasts = 0
  on('env.get', async () => ({ value: 'C:\\Users\\x' }) as never)
  on('session.id', async () => ({ value: 'ich' }) as never)
  on('session.root', async () => ({ value: 'C:\\P' }) as never)
  on('clock.now', async () => ({ value: 2_000 }) as never)
  on('clock.every', async () => ({ value: { cancel() {} } }) as never)
  on('fs.read', async () => ({ value: file }) as never)
  on('fs.write', async (_$, e: any) => {
    file = e.text
    return { value: undefined } as never
  })
  on('ui.toast', async () => {
    toasts++
    return { value: undefined } as never
  })
  on('ui.render', async ($r, e) => {
    const { Box } = $r.ui.resolve(e)
    return <Box key="engine" />
  })
  on('session.start', async (_$, e) => ({ ...e, cwd: '/' }) as never)
  mock.store(on)
  await $.session.start({ source: 'startup', cwd: '/' } as never)

  expect(JSON.parse(file).sessions.ich.dir).toBe('c:/p')
  expect(toasts).toBe(1)
  const ui = await $.ui.mount({ plugin: 'sitzungs-waechter', surface: 'terminal', component: 'AbovePrompt', props: {} as never })
  expect(await ui.find({ type: 'Text', text: /zweite Sitzung/ })).toBeDefined()
  await ui.press({ key: 'ok' })
  expect(await ui.find({ key: 'ok' })).toBeUndefined()
  await ui.unmount()
})
