import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Naechste Schritte als Band UEBER dem Eingabefeld. Ist Claude mit einer Antwort
// fertig, fragt das Plugin Claude selbst (ueber $.model.fork auf dem laufenden
// Gespraech) nach den drei wahrscheinlichsten naechsten Schritten. Prio 1 ist
// der wahrscheinlichste und gruen, 2 und 3 sind Alternativen. Ein Klick schickt
// den Schritt als naechsten Prompt. Ein Fork erzeugt keinen neuen Zug, die
// Erzeugung laeuft also nie in einer Schleife. Mit "/vorschlaege" an/aus.
//
// Derselbe Fork liefert auch die stillen Annahmen fuer den Mod "annahmen"
// (eine Anfrage statt zwei, spart Tokens). Sie liegen in "shared"; nur
// next-steps schreibt dort, annahmen liest. Ist next-steps aus, fragt annahmen
// selbst.

const GREEN = '#22c55e'
const MAX_STEPS = 3
const MAX_ASSUMPTIONS = 6
const MAX_LEN = 200 // volle Laenge beim Abschicken
const BAND_LEN = 72 // gekuerzt fuer die Anzeige im schmalen Band

const FORK_PROMPT = [
  'Antworte in genau zwei Abschnitten und nutze keine Werkzeuge.',
  'Abschnitt 1 beginnt mit der Zeile SCHRITTE: Darunter genau 3 realistische',
  'naechste Schritte, um diese Arbeit fortzusetzen, der wahrscheinlichste zuerst.',
  'Jeder Schritt ist eine kurze Anweisung im Imperativ, die ein Entwickler als',
  'Naechstes an dich schicken koennte (eine Zeile, hoechstens etwa 100 Zeichen).',
  'Abschnitt 2 beginnt mit der Zeile ANNAHMEN: Darunter die Annahmen, die du in',
  'deiner letzten Antwort und der Arbeit dafuer STILL getroffen hast: kleine',
  'Entscheidungen, die der Nutzer nicht ausdruecklich vorgegeben hat (z.B. Namen,',
  'Orte, Standardwerte, Reihenfolge, was weggelassen wurde, wie etwas gemeint war).',
  'Nur solche, die falsch sein koennten und die der Nutzer pruefen sollte.',
  `Hoechstens ${MAX_ASSUMPTIONS}, je ein kurzer deutscher Satz in einer Zeile`,
  '(hoechstens etwa 120 Zeichen). Gibt es keine, schreibe darunter nur KEINE.',
  'Keine Nummerierung, keine Aufzaehlungszeichen, keine Einleitung, keine Erklaerung.',
].join(' ')

// Aktuelle Vorschlaege. Nur pro Sitzung.
const suggestions = atom(
  { plugin: 'next-steps', key: 'suggestions' } as const,
  [] as string[],
)
// Laeuft gerade ein Fork?
const loading = atom({ plugin: 'next-steps', key: 'loading' } as const, false)
// Automatisch Vorschlaege machen? Wird gespeichert.
const enabled = atom({ plugin: 'next-steps', key: 'enabled' } as const, true)
// Fuer den Mod "annahmen": Annahmen aus demselben Fork. gen zaehlt jede neue
// Erzeugung hoch, damit annahmen weiss, wann eine neue Liste da ist.
const shared = atom(
  { plugin: 'next-steps', key: 'shared' } as const,
  { gen: 0, loading: false, assumptions: [] as string[] },
)

// Zaehler, damit eine alte, langsame Antwort eine neuere nicht ueberschreibt.
let generation = 0

// Zu lange Zeile fuers Band kuerzen.
function cut(text: string): string {
  return text.length > BAND_LEN ? text.slice(0, BAND_LEN - 3) + '...' : text
}

// Zeilen zerlegen: Nummern, Spiegelstriche und Aufzaehlungszeichen vorne weg,
// leere und doppelte Zeilen raus, hoechstens max Zeilen. "KEINE" = nichts.
function parseLines(lines: string[], max: number): string[] {
  const out: string[] = []
  for (const line of lines) {
    const clean = line
      .replace(/^\s*(?:[-*•–—]+|\d+\s*[.):])\s*/, '')
      .replace(/^annahme\s*\d*\s*:\s*/i, '')
      .replace(/^[`"']+|[`"']+$/g, '')
      .trim()
    if (!clean || /^keine\.?$/i.test(clean) || out.includes(clean)) continue
    out.push(clean.length > MAX_LEN ? clean.slice(0, MAX_LEN - 3) + '...' : clean)
    if (out.length >= max) break
  }

  return out
}

// Fork-Antwort in die Abschnitte SCHRITTE und ANNAHMEN teilen. Fehlen die
// Ueberschriften, gilt alles als Schritte.
export function parseFork(text: string): { steps: string[]; assumptions: string[] } {
  const steps: string[] = []
  const assumptions: string[] = []
  let target = steps
  for (const line of text.split(/\r?\n/)) {
    const head = line.replace(/[*#_`]/g, '').trim()
    if (/^schritte\s*:?$/i.test(head)) {
      target = steps
      continue
    }
    if (/^annahmen\s*:?$/i.test(head)) {
      target = assumptions
      continue
    }
    target.push(line)
  }

  return {
    steps: parseLines(steps, MAX_STEPS),
    assumptions: parseLines(assumptions, MAX_ASSUMPTIONS),
  }
}

// Vorschlaege (und Annahmen fuer "annahmen") erzeugen: ein Fork, zwei Listen.
async function generate($: EngineInterface) {
  const mine = ++generation
  await update($, loading, () => true)
  await update($, suggestions, () => [])
  await update($, shared, s => ({ gen: s.gen + 1, loading: true, assumptions: [] }))

  let steps: string[] = []
  let assumptions: string[] = []
  try {
    const r = await $.model.fork({ prompt: FORK_PROMPT })
    if (r.isAnswered) {
      ;({ steps, assumptions } = parseFork(r.text))
    } else if (r.reason === 'api-error') {
      $.ui.toast('Vorschlaege: Fehler bei der Anfrage.')
    }
  } catch {
    $.ui.toast('Vorschlaege: Anfrage fehlgeschlagen.')
  }

  if (mine !== generation) return
  await update($, suggestions, () => steps)
  await update($, loading, () => false)
  await update($, shared, s => ({ ...s, loading: false, assumptions }))
}

// Ein/Aus umschalten: Atom und Store zusammen.
async function toggleEnabled($: EngineInterface) {
  const next = !(await read($, enabled))
  await update($, enabled, () => next)
  await $.store.set('enabled', next)
  $.ui.toast(next ? 'Vorschlaege an' : 'Vorschlaege aus')
  if (!next) {
    generation++
    await update($, loading, () => false)
    await update($, suggestions, () => [])
    await update($, shared, x => ({ ...x, loading: false }))
  }
}

// Vorschlag anklicken: als Prompt schicken, Liste leeren.
async function pick($: EngineInterface, text: string) {
  generation++
  await update($, suggestions, () => [])
  await update($, loading, () => false)
  await update($, shared, x => ({ ...x, loading: false }))
  await $.prompt.submit({ text, asUser: true })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('enabled')
    await update($, enabled, () => saved !== false)
    await $.command.register({
      name: 'vorschlaege',
      description: 'Vorschlaege-Band ueber dem Eingabefeld an- oder ausschalten',
    })

    return next(e)
  })

  on('command.run', { command: 'vorschlaege' }, async $ => {
    await toggleEnabled($)
    const isOn = await read($, enabled)

    return { text: isOn ? 'Vorschlaege sind an.' : 'Vorschlaege sind aus.' }
  })

  on('turn.complete', async ($, e, next) => {
    // Nur die Hauptschleife zaehlt, nur erfolgreiche Antworten.
    if (e.agentId || e.reason !== 'answer') return next(e)
    if (!(await read($, enabled))) return next(e)

    // Nicht blockieren: Erzeugung starten und den Zug sofort weitergeben.
    void generate($)

    return next(e)
  })

  // Band ueber dem Eingabefeld. Nur EIN Band ("one instance"), darum reichen wir
  // das darunterliegende Band (below) durch und haengen unseres an.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props?.hasSurvey) return below
    if (!(await read($, enabled))) return below

    const busy = await read($, loading)
    const list = await read($, suggestions)
    if (!busy && list.length === 0) return below

    const { Box, Text, Button } = $.ui.resolve(e)

    if (busy) {
      return (
        <Box flexDirection="column">
          {below}
          <Box gap={1}>
            <Text dimColor>{'◆'} Vorschlaege: denkt nach ...</Text>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {below}
        {list.map((text, i) => (
          <Box key={'s-' + i} gap={1} alignItems="flex-start">
            {i === 0 ? (
              <Text bold color={GREEN}>
                1
              </Text>
            ) : (
              <Text dimColor>{i + 1}</Text>
            )}
            <Button
              key={'pick-' + i}
              label={cut(text)}
              onPress={() => void pick($, text)}
            />
          </Box>
        ))}
        <Box gap={1}>
          <Button key="again" label="neu" onPress={() => void generate($)} />
          <Button key="off" label="aus" onPress={() => void toggleEnabled($)} />
        </Box>
      </Box>
    )
  })
}
