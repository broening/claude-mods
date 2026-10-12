import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Other } from '../types'

// Sitzungs-Waechter: warnt, wenn eine zweite Claude-Code-Sitzung im selben
// Ordner laeuft. Zwei Sitzungen, die dieselben Dateien aendern, ueberschreiben
// sich sonst gegenseitig.
//
// Jede Sitzung traegt sich alle 30 Sekunden in eine gemeinsame Liste ein
// (~/.claude/sitzungs-waechter.json): Sitzungs-ID, Ordner, Zeit. Eintraege
// ohne Lebenszeichen seit 90 Sekunden gelten als tot und fliegen raus. Steht
// eine andere lebende Sitzung mit demselben Ordner in der Liste, zeigt das Band
// ueber dem Prompt eine Warnung. "ok" blendet sie aus, bis sich die Liste der
// anderen Sitzungen aendert.

const RED = '#ef4444'
const BEAT_MS = 30_000
const STALE_MS = 90_000
const FILE_NAME = 'sitzungs-waechter.json'

export type Entry = { dir: string; ts: number; start: number }
export type Registry = { sessions: Record<string, Entry> }

const others = atom({ plugin: 'sitzungs-waechter', key: 'others' } as const, [] as Other[])
const dismissed = atom({ plugin: 'sitzungs-waechter', key: 'dismissed' } as const, '')

let timer: { cancel: () => void } | undefined
let started = 0

// Ordner vergleichbar machen: Windows ist gross/klein egal, / und \ gleich.
export function normDir(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// Liste lesen. Kaputt oder fehlend = leer.
export function parseRegistry(text: string | undefined): Registry {
  try {
    const raw = JSON.parse(text ?? '') as Registry
    if (raw && typeof raw.sessions === 'object' && raw.sessions) return { sessions: { ...raw.sessions } }
  } catch {}
  return { sessions: {} }
}

// Tote Eintraege raus, eigenen Eintrag setzen (oder mit entry undefined loeschen).
export function merge(reg: Registry, id: string, entry: Entry | undefined, now: number): Registry {
  const sessions: Record<string, Entry> = {}
  for (const [key, e] of Object.entries(reg.sessions)) {
    if (key !== id && e && now - e.ts < STALE_MS) sessions[key] = e
  }
  if (entry) sessions[id] = entry

  return { sessions }
}

// Andere lebende Sitzungen im selben Ordner, die aelteste zuerst.
export function othersIn(reg: Registry, id: string, dir: string, now: number): Other[] {
  return Object.entries(reg.sessions)
    .filter(([key, e]) => key !== id && e.dir === dir && now - e.ts < STALE_MS)
    .map(([key, e]) => ({ id: key, start: e.start }))
    .sort((a, b) => a.start - b.start)
}

function keyOf(list: Other[]): string {
  return list.map(o => o.id).sort().join(',')
}

async function registryPath($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '.'
  return home.replace(/[\\/]+$/, '') + '/.claude/' + FILE_NAME
}

async function load($: EngineInterface, path: string): Promise<Registry> {
  const text = await $.fs.read(path).catch(() => undefined)
  return parseRegistry(typeof text === 'string' ? text : undefined)
}

// Ein Lebenszeichen: eintragen, schreiben, andere Sitzungen pruefen.
async function beat($: EngineInterface) {
  try {
    const path = await registryPath($)
    const id = await $.session.id()
    const dir = normDir(await $.session.root())
    const now = await $.clock.now()
    if (!started) started = now
    const reg = merge(await load($, path), id, { dir, ts: now, start: started }, now)
    await $.fs.write(path, JSON.stringify(reg, null, 1))

    const list = othersIn(reg, id, dir, now)
    const before = await read($, others)
    await update($, others, () => list)
    const fresh = list.some(o => !before.some(b => b.id === o.id))
    if (fresh && keyOf(list) !== (await read($, dismissed))) {
      $.ui.toast('Achtung: Eine zweite Sitzung arbeitet im selben Ordner.')
    }
  } catch {
    // Waechter darf nie die Sitzung stoeren.
  }
}

// Eigenen Eintrag loeschen (Sitzung endet oder /clear).
async function leave($: EngineInterface, id: string) {
  try {
    const path = await registryPath($)
    const now = await $.clock.now()
    const reg = merge(await load($, path), id, undefined, now)
    await $.fs.write(path, JSON.stringify(reg, null, 1))
  } catch {}
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    timer?.cancel()
    started = 0
    await beat($)
    timer = $.clock.every(BEAT_MS, () => void beat($))

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    await leave($, e.sessionId)
    // Nach /clear laeuft der Prozess weiter, aber ohne session.start.
    if (e.reason === 'clear') {
      started = 0
      timer = $.clock.every(BEAT_MS, () => void beat($))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props?.hasSurvey) return below

    const list = await read($, others)
    if (list.length === 0) return below
    const key = keyOf(list)
    if (key === (await read($, dismissed))) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const n = list.length
    const label =
      n === 1
        ? 'Eine zweite Sitzung arbeitet im selben Ordner.'
        : n + ' weitere Sitzungen arbeiten im selben Ordner.'

    return (
      <Box flexDirection="column">
        {below}
        <Box gap={1}>
          <Text bold color={RED}>
            {'⚠'}
          </Text>
          <Text>{label} Dateien koennen sich ueberschreiben.</Text>
          <Button key="ok" label="ok" onPress={() => void update($, dismissed, () => key)} />
        </Box>
      </Box>
    )
  })
}
