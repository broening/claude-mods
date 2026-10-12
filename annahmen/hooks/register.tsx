import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { Assumption, Mark } from '../types'

// Annahmen-Pruefer als Band UEBER dem Eingabefeld. Ist Claude mit einer Antwort
// fertig, fragt der Mod Claude selbst (ueber $.model.fork auf dem laufenden
// Gespraech) nach den Annahmen, die es still getroffen hat. Das Band zeigt erst
// nur die Zahl; "pruefen" klappt die Liste auf. Jede Annahme bekommt richtig
// oder falsch. "Korrektur senden" schickt die falschen (plus Notiz) als neuen
// Auftrag an Claude. Ein Fork erzeugt keinen neuen Zug, also keine Schleife.
// Mit "/annahmen" an/aus.

const GREEN = '#22c55e'
const RED = '#ef4444'
const MAX_ITEMS = 6
const MAX_LEN = 200 // volle Laenge beim Abschicken
const BAND_LEN = 90 // gekuerzt fuer die Anzeige im Band

const FORK_PROMPT = [
  'Pruefe deine letzte Antwort und die Arbeit dafuer.',
  'Liste die Annahmen, die du STILL getroffen hast: kleine Entscheidungen, die',
  'der Nutzer nicht ausdruecklich vorgegeben hat (z.B. Namen, Orte, Standardwerte,',
  'Reihenfolge, was weggelassen wurde, wie etwas gemeint war).',
  'Nur Annahmen, die falsch sein koennten und die der Nutzer pruefen sollte.',
  `Hoechstens ${MAX_ITEMS}. Jede Annahme ist ein kurzer deutscher Satz in einer`,
  'Zeile (hoechstens etwa 120 Zeichen), ohne Nummer, ohne Einleitung.',
  'Gibt es keine solche Annahme, antworte nur mit dem Wort KEINE.',
  'Nutze keine Werkzeuge.',
].join(' ')

const items = atom({ plugin: 'annahmen', key: 'items' } as const, [] as Assumption[])
const expanded = atom({ plugin: 'annahmen', key: 'expanded' } as const, false)
const loading = atom({ plugin: 'annahmen', key: 'loading' } as const, false)
const enabled = atom({ plugin: 'annahmen', key: 'enabled' } as const, true)
const note = atom({ plugin: 'annahmen', key: 'note' } as const, '')

// Zaehler, damit eine alte, langsame Antwort eine neuere nicht ueberschreibt.
let generation = 0

function cut(text: string): string {
  return text.length > BAND_LEN ? text.slice(0, BAND_LEN - 3) + '...' : text
}

// Antwort des Forks in bis zu MAX_ITEMS Zeilen zerlegen: Nummern und
// Aufzaehlungszeichen vorne weg, leere und doppelte Zeilen raus. "KEINE" = leer.
export function parseAssumptions(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const clean = line
      .replace(/^\s*(?:[-*•–—]+|\d+\s*[.):])\s*/, '')
      .replace(/^(?:annahme\s*\d*\s*:\s*)/i, '')
      .replace(/^[`"']+|[`"']+$/g, '')
      .trim()
    if (!clean || /^keine\.?$/i.test(clean) || out.includes(clean)) continue
    out.push(clean.length > MAX_LEN ? clean.slice(0, MAX_LEN - 3) + '...' : clean)
    if (out.length >= MAX_ITEMS) break
  }

  return out
}

// Text des Korrektur-Auftrags bauen. Leer, wenn nichts falsch markiert ist.
export function buildCorrection(list: Assumption[], extra: string): string {
  const wrong = list.filter(a => a.mark === 'falsch')
  if (wrong.length === 0) return ''
  const right = list.filter(a => a.mark === 'richtig')
  const lines = ['Diese Annahmen von dir waren falsch. Bitte korrigiere sie:']
  for (const a of wrong) lines.push('- ' + a.text)
  if (right.length > 0) {
    lines.push('', 'Diese Annahmen waren richtig, behalte sie:')
    for (const a of right) lines.push('- ' + a.text)
  }
  const n = extra.trim()
  if (n) lines.push('', 'Hinweis von mir: ' + n)
  lines.push('', 'Wenn dir unklar ist, wie es richtig waere, frag mich zuerst.')

  return lines.join('\n')
}

async function clear($: EngineInterface) {
  generation++
  await update($, items, () => [])
  await update($, expanded, () => false)
  await update($, loading, () => false)
  await update($, note, () => '')
}

async function generate($: EngineInterface) {
  const mine = ++generation
  await update($, loading, () => true)
  await update($, items, () => [])
  await update($, expanded, () => false)

  let found: string[] = []
  try {
    const r = await $.model.fork({ prompt: FORK_PROMPT })
    if (r.isAnswered) {
      found = parseAssumptions(r.text)
    } else if (r.reason === 'api-error') {
      $.ui.toast('Annahmen: Fehler bei der Anfrage.')
    }
  } catch {
    $.ui.toast('Annahmen: Anfrage fehlgeschlagen.')
  }

  if (mine !== generation) return
  await update($, items, () => found.map(text => ({ text, mark: 'offen' as Mark })))
  await update($, loading, () => false)
}

async function setMark($: EngineInterface, index: number, mark: Mark) {
  await update($, items, list =>
    list.map((a, i) => (i === index ? { ...a, mark: a.mark === mark ? 'offen' : mark } : a)),
  )
}

async function sendCorrection($: EngineInterface) {
  const text = buildCorrection(await read($, items), await read($, note))
  if (!text) return
  await clear($)
  await $.prompt.submit({ text, asUser: true })
}

async function toggleEnabled($: EngineInterface) {
  const next = !(await read($, enabled))
  await update($, enabled, () => next)
  await $.store.set('enabled', next)
  if (!next) await clear($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('enabled')
    await update($, enabled, () => saved !== false)
    await $.command.register({
      name: 'annahmen',
      description: 'Annahmen-Band ueber dem Eingabefeld an- oder ausschalten',
    })

    return next(e)
  })

  on('command.run', { command: 'annahmen' }, async $ => {
    await toggleEnabled($)
    const isOn = await read($, enabled)

    return { text: isOn ? 'Annahmen-Pruefer ist an.' : 'Annahmen-Pruefer ist aus.' }
  })

  // Neuer Prompt: alte Annahmen gehoeren zur alten Antwort, also weg.
  on('prompt.submit', async ($, e, next) => {
    await clear($)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId || e.reason !== 'answer') return next(e)
    if (!(await read($, enabled))) return next(e)
    void generate($)

    return next(e)
  })

  // Nur EIN Band ueber dem Prompt: darunterliegendes Band durchreichen, unseres
  // anhaengen.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props?.hasSurvey) return below
    if (!(await read($, enabled))) return below

    const busy = await read($, loading)
    const list = await read($, items)
    if (!busy && list.length === 0) return below

    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    // Nicht jede Oberflaeche hat ein Eingabefeld; dann ohne Notiz.
    const Input = 'Input' in el ? el.Input : undefined

    if (busy) {
      return (
        <Box flexDirection="column">
          {below}
          <Text dimColor>{'◇'} Annahmen: sucht ...</Text>
        </Box>
      )
    }

    const open = await read($, expanded)
    const wrong = list.filter(a => a.mark === 'falsch').length

    if (!open) {
      return (
        <Box flexDirection="column">
          {below}
          <Box gap={1}>
            <Text color="yellow">{'◇'}</Text>
            <Text>
              {list.length} {list.length === 1 ? 'Annahme' : 'Annahmen'}
            </Text>
            <Button key="open" label="pruefen" onPress={() => void update($, expanded, () => true)} />
            <Button key="dismiss" label="weg" onPress={() => void clear($)} />
          </Box>
        </Box>
      )
    }

    const noteText = await read($, note)

    return (
      <Box flexDirection="column">
        {below}
        <Text bold color="yellow">
          {'◇'} Annahmen von Claude: richtig oder falsch?
        </Text>
        {list.map((a, i) => (
          <Box key={'a-' + i} gap={1} alignItems="flex-start">
            <Text color={a.mark === 'richtig' ? GREEN : a.mark === 'falsch' ? RED : undefined} dimColor={a.mark === 'offen'}>
              {a.mark === 'richtig' ? '✓' : a.mark === 'falsch' ? '✗' : String(i + 1)}
            </Text>
            <Text>{cut(a.text)}</Text>
            <Button key={'ok-' + i} label="richtig" onPress={() => void setMark($, i, 'richtig')} />
            <Button key={'no-' + i} label="falsch" onPress={() => void setMark($, i, 'falsch')} />
          </Box>
        ))}
        {Input ? (
        <Input
          key="note"
          placeholder="Notiz an Claude (optional)"
          submitLabel="Korrektur senden"
          value={noteText}
          onInput={(value: string) => void update($, note, () => value)}
          onSubmit={(value: string) => {
            void update($, note, () => value).then(() => sendCorrection($))
          }}
        />
        ) : null}
        <Box gap={1}>
          {wrong > 0 ? (
            <Button key="send" label={'Korrektur senden (' + wrong + ')'} onPress={() => void sendCorrection($)} />
          ) : null}
          <Button key="close" label="zuklappen" onPress={() => void update($, expanded, () => false)} />
          <Button key="done" label="alles gut" onPress={() => void clear($)} />
        </Box>
      </Box>
    )
  })
}
