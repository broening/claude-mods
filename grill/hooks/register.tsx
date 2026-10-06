import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Frage } from '../types'

// Grill-Assistent als Band UEBER dem Eingabefeld. Mit "/grill" (optional
// "/grill <thema>") fragt das Plugin Claude selbst (ueber $.model.fork auf dem
// laufenden Gespraech) nach bis zu 5 Rueckfragen, die den aktuellen Plan oder
// die Entscheidung auf die Probe stellen. Das Band zeigt eine Frage nach der
// anderen: Antwortoptionen, den KI-Vorschlag und ein Feld fuer eine eigene
// Antwort. Nach der letzten Frage gehen alle Antworten gesammelt als Prompt an
// Claude. Ein Fork erzeugt keinen neuen Zug. Nur pro Sitzung, nichts gespeichert.

const GREEN = '#22c55e'
const MAX_FRAGEN = 5
const MAX_OPTIONEN = 4
const LABEL_LEN = 70 // gekuerzt fuer die Anzeige im schmalen Band

const FORK_PROMPT = [
  'Stelle den aktuellen Plan bzw. die aktuelle Entscheidung aus diesem Gespraech',
  'auf die Probe. Formuliere bis zu 5 kurze Rueckfragen, die Schwachstellen,',
  'offene Annahmen und Risiken aufdecken. Die wichtigste Frage kommt zuerst.',
  'Jede Frage hat 2 bis 4 konkrete Antwortoptionen, die sich gegenseitig',
  'ausschliessen, und genau eine empfohlene Option als "vorschlag" (sie muss',
  'wortgleich eine der Optionen sein).',
  'Antworte NUR mit einem JSON-Array, ohne Text davor oder danach und ohne',
  'Code-Zaeune. Jedes Element hat die Form',
  '{ "frage": string, "optionen": string[], "vorschlag": string }.',
  'Rufe keine Werkzeuge auf.',
].join(' ')

// Sitzungszustand. Nur pro Sitzung.
const fragen = atom({ plugin: 'grill', key: 'fragen' } as const, [] as Frage[])
const antworten = atom(
  { plugin: 'grill', key: 'antworten' } as const,
  [] as (string | null)[],
)
const index = atom({ plugin: 'grill', key: 'index' } as const, 0)
const aktiv = atom({ plugin: 'grill', key: 'aktiv' } as const, false)
const laden = atom({ plugin: 'grill', key: 'laden' } as const, false)
const draft = atom({ plugin: 'grill', key: 'draft' } as const, '')

// Zaehler, damit ein altes, langsames /grill ein neueres nicht ueberschreibt.
let generation = 0

// Zu lange Zeile fuers Band kuerzen.
function cut(text: string): string {
  return text.length > LABEL_LEN ? text.slice(0, LABEL_LEN - 3) + '...' : text
}

// Antwort des Forks in Fragen zerlegen: Code-Zaeune weg, vom ersten '[' bis zum
// letzten ']' lesen, nur wohlgeformte Eintraege behalten.
function parseFragen(text: string): Frage[] {
  const clean = text.replace(/```[a-zA-Z]*/g, '')
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start < 0 || end <= start) return []

  let raw: unknown
  try {
    raw = JSON.parse(clean.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out: Frage[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as { frage?: unknown; optionen?: unknown; vorschlag?: unknown }
    if (typeof o.frage !== 'string' || !o.frage.trim()) continue
    const optionen = Array.isArray(o.optionen)
      ? o.optionen
          .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
          .map(x => x.trim())
          .slice(0, MAX_OPTIONEN)
      : []
    out.push({
      frage: o.frage.trim(),
      optionen,
      vorschlag: typeof o.vorschlag === 'string' ? o.vorschlag.trim() : '',
    })
    if (out.length >= MAX_FRAGEN) break
  }

  return out
}

// Sitzung komplett leeren und das Band ausblenden.
async function clearSession($: EngineInterface) {
  await update($, aktiv, () => false)
  await update($, laden, () => false)
  await update($, fragen, () => [])
  await update($, antworten, () => [])
  await update($, index, () => 0)
  await update($, draft, () => '')
}

// Fragen erzeugen: Fork starten, Antwort zerlegen, Sitzung starten.
async function startGrill($: EngineInterface, focus: string) {
  const mine = ++generation
  await update($, aktiv, () => true)
  await update($, laden, () => true)
  await update($, fragen, () => [])
  await update($, antworten, () => [])
  await update($, index, () => 0)
  await update($, draft, () => '')

  const prompt = focus
    ? FORK_PROMPT + ' Konzentriere dich auf: ' + focus
    : FORK_PROMPT

  let list: Frage[] = []
  let grund = 'Grill: keine Fragen erhalten.'
  try {
    const r = await $.model.fork({ prompt })
    if (r.isAnswered) {
      list = parseFragen(r.text)
    } else if (r.reason === 'nothing-to-fork') {
      if (focus) {
        // Kein Gespraech zum Hinterfragen, aber ein Thema: direkt dazu fragen
        // (ohne Verlauf, per $.model.complete).
        const model = (await $.session.model()) || 'sonnet'
        const direct = await $.model.complete({
          model,
          prompt: 'Thema: ' + focus + '\n\n' + FORK_PROMPT,
          maxTokens: 1024,
        })
        if (direct.isAnswered) list = parseFragen(direct.text)
      } else {
        grund =
          'Grill: erst ein Gespraech fuehren, oder "/grill <thema>" mit einem Thema nutzen.'
      }
    }
  } catch {
    // grund bleibt
  }

  if (mine !== generation) return

  if (list.length === 0) {
    await clearSession($)
    $.ui.toast(grund)

    return
  }

  await update($, fragen, () => list)
  await update($, antworten, () => list.map(() => null))
  await update($, index, () => 0)
  await update($, laden, () => false)
}

// Alle Antworten sammeln, Sitzung leeren, als Prompt an Claude schicken.
async function finish($: EngineInterface) {
  const list = await read($, fragen)
  const answers = await read($, antworten)

  const lines = ['Hier meine Antworten auf deine Rueckfragen:']
  list.forEach((f, i) => {
    lines.push('- ' + f.frage + ' => ' + (answers[i] ?? '(offen)'))
  })
  const text = lines.join('\n')

  generation++
  await clearSession($)
  await $.prompt.submit({ text, asUser: true })
}

// Antwort zu Frage i festhalten und weiterschalten (nach der letzten: fertig).
async function antwort($: EngineInterface, i: number, text: string) {
  const list = await read($, fragen)
  await update($, antworten, a => a.map((x, k) => (k === i ? text : x)))
  await update($, draft, () => '')

  if (i >= list.length - 1) {
    await finish($)
  } else {
    await update($, index, () => i + 1)
  }
}

// Abbrechen: Sitzung leeren, laufenden Fork verwerfen.
async function abbrechen($: EngineInterface) {
  generation++
  await clearSession($)
  $.ui.toast('Grill abgebrochen.')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'grill',
      description:
        'Grill: Claude stellt dir bis zu 5 Rueckfragen zu deinem Plan, mit "/grill <thema>" mit Schwerpunkt',
    })

    return next(e)
  })

  on('command.run', { command: 'grill' }, async ($, e) => {
    // Nicht blockieren: Fork im Hintergrund, das Band zeigt "denkt nach".
    void startGrill($, e.args.trim())

    return { text: 'Grill gestartet.' }
  })

  // Band ueber dem Eingabefeld. Es gibt nur EIN Band ("one instance"), darum
  // reichen wir das darunterliegende Band (below) durch und haengen unseres an.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (!(await read($, aktiv)) || e.props?.hasSurvey) return below

    const { Box, Text, Button, Input } = $.ui.resolve(e)

    if (await read($, laden)) {
      return (
        <Box flexDirection="column">
          {below}
          <Box gap={1}>
            <Text dimColor>{'\u25C6'} Grill: denkt nach ...</Text>
          </Box>
        </Box>
      )
    }

    const list = await read($, fragen)
    const answers = await read($, antworten)
    const at = await read($, index)
    const draftText = await read($, draft)

    const frage = list[at]
    if (!frage) return below

    const isLast = at >= list.length - 1
    const given = answers[at]

    return (
      <Box flexDirection="column">
        {below}
        <Text bold color={GREEN}>
          Frage {at + 1}/{list.length}
        </Text>
        <Text bold>{frage.frage}</Text>
        {given != null && <Text dimColor>Deine Antwort: {cut(given)}</Text>}
        {frage.optionen.map((option, i) => (
          <Box key={'opt-' + at + '-' + i} gap={1} alignItems="flex-start">
            <Text dimColor>{i + 1}</Text>
            <Button
              key={'opt-btn-' + at + '-' + i}
              label={cut(option)}
              onPress={() => void antwort($, at, option)}
            />
          </Box>
        ))}
        {frage.vorschlag !== '' && (
          <Box gap={1} alignItems="flex-start">
            <Text bold color={GREEN}>
              {'\u2605'}
            </Text>
            <Button
              key={'ki-' + at}
              label={cut('KI-Vorschlag: ' + frage.vorschlag)}
              onPress={() => void antwort($, at, frage.vorschlag)}
            />
          </Box>
        )}
        <Input
          key={'own-' + at}
          placeholder="eigene Antwort, Enter"
          submitLabel="antworten"
          autoFocus
          value={draftText}
          onInput={value => void update($, draft, () => value)}
          onSubmit={value => {
            const text = value.trim()
            if (text) void antwort($, at, text)
          }}
        />
        <Box gap={1}>
          <Button
            key="zurueck"
            label="zurueck"
            onPress={() => void update($, index, i => Math.max(0, i - 1))}
          />
          <Button
            key="weiter"
            label={isLast ? 'fertig' : 'weiter'}
            onPress={() => {
              if (isLast) void finish($)
              else void update($, index, i => i + 1)
            }}
          />
          <Button key="abbrechen" label="abbrechen" onPress={() => void abbrechen($)} />
        </Box>
      </Box>
    )
  })
}
