import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Prompt-Verbesserer als Band UEBER dem Eingabefeld. Steht ein Entwurf im
// Eingabefeld, zeigt das Band den Knopf "Prompt verbessern". Der Knopf fragt
// Claude (ueber $.model.fork, kennt also Gespraech, Projekt und Skill-Liste),
// den Entwurf besser zu schreiben: passende Skills/Agents nennen, Entscheidungen
// vorher klaeren, Zielbild beschreiben. Das Ergebnis ERSETZT nur den Entwurf im
// Eingabefeld; gesendet wird nichts. "rueckgaengig" holt den alten Entwurf
// zurueck. Mit "/verbessern" an/aus.

const FORK_PROMPT_HEAD = [
  'Der Nutzer hat im Eingabefeld diesen Prompt-Entwurf getippt, aber NOCH NICHT',
  'gesendet. Fuehre ihn NICHT aus. Schreibe ihn nur als besseren Prompt an dich',
  'selbst um, in der Sprache des Entwurfs:',
  '- Behalte Absicht und alle Fakten des Entwurfs. Erfinde nichts dazu.',
  '- Nutze, was du aus dem bisherigen Gespraech und dem Projekt weisst.',
  '- Nenne die Skills (als /name) und Agent-Typen aus deiner Liste, die wirklich',
  '  passen. Keine, wenn keine passt.',
  '- Liste die wichtigen Entscheidungen, die du vor dem Start fragen sollst.',
  '- Beschreibe kurz, woran man erkennt, dass die Aufgabe fertig ist.',
  '- Hoechstens etwa 15 kurze Zeilen.',
  'Antworte NUR mit dem neuen Prompt-Text: ohne Einleitung, ohne Codeblock,',
  'ohne Erklaerung. Nutze keine Werkzeuge.',
  '',
  'Entwurf:',
].join('\n')

const hasDraft = atom({ plugin: 'prompt-boost', key: 'hasDraft' } as const, false)
const busy = atom({ plugin: 'prompt-boost', key: 'busy' } as const, false)
// Der Entwurf vor dem Umschreiben; '' = nichts rueckgaengig zu machen.
const original = atom({ plugin: 'prompt-boost', key: 'original' } as const, '')
const enabled = atom({ plugin: 'prompt-boost', key: 'enabled' } as const, true)
// Meldet das Eingabefeld Tippen (prompt.edit)? Manche Oberflaechen tun das
// nicht; dann steht der Knopf immer da und prueft beim Druecken selbst.
const editSeen = atom({ plugin: 'prompt-boost', key: 'editSeen' } as const, false)

// Zaehler, damit eine alte Antwort nach "abbrechen" nichts mehr ersetzt.
let generation = 0

// Antwort des Forks saeubern: Codeblock-Zaeune und Rahmen-Leerzeilen weg.
export function cleanRewrite(text: string): string {
  let t = text.trim()
  const fence = /^```[a-zA-Z]*\r?\n([\s\S]*?)\r?\n```$/.exec(t)
  if (fence?.[1] !== undefined) t = fence[1].trim()
  t = t.replace(/^(?:verbesserter prompt|neuer prompt|prompt)\s*:\s*\n/i, '')

  return t.trim()
}

export function buildForkPrompt(draft: string): string {
  return FORK_PROMPT_HEAD + '\n<<<\n' + draft + '\n>>>'
}

async function boost($: EngineInterface) {
  const { text: draft } = await $.prompt.read()
  if (!draft.trim()) {
    $.ui.toast('Prompt verbessern: Erst einen Entwurf ins Eingabefeld tippen.')
    return
  }
  const mine = ++generation
  await update($, busy, () => true)

  let rewrite = ''
  try {
    const r = await $.model.fork({ prompt: buildForkPrompt(draft) })
    if (r.isAnswered) {
      rewrite = cleanRewrite(r.text)
    } else if (r.reason === 'api-error') {
      $.ui.toast('Prompt verbessern: Fehler bei der Anfrage.')
    }
  } catch {
    $.ui.toast('Prompt verbessern: Anfrage fehlgeschlagen.')
  }

  if (mine !== generation) return
  await update($, busy, () => false)
  if (!rewrite) return

  // Hat der Nutzer inzwischen weitergetippt, nichts ueberschreiben.
  const { text: now } = await $.prompt.read()
  if (now !== draft) {
    $.ui.toast('Prompt verbessern: Entwurf hat sich geaendert, nichts ersetzt.')
    return
  }
  const filled = await $.prompt.fill({ text: rewrite, mode: 'replace' })
  if (filled.isFilled) {
    await update($, original, () => draft)
  } else {
    $.ui.toast('Prompt verbessern: Eingabefeld nimmt gerade keinen Text an.')
  }
}

async function cancel($: EngineInterface) {
  generation++
  await update($, busy, () => false)
}

async function undo($: EngineInterface) {
  const old = await read($, original)
  if (!old) return
  await update($, original, () => '')
  await $.prompt.fill({ text: old, mode: 'replace' })
}

async function toggleEnabled($: EngineInterface) {
  const next = !(await read($, enabled))
  await update($, enabled, () => next)
  await $.store.set('enabled', next)
  if (!next) {
    await cancel($)
    await update($, original, () => '')
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('enabled')
    await update($, enabled, () => saved !== false)
    await $.command.register({
      name: 'verbessern',
      description: 'Prompt-Verbesserer ueber dem Eingabefeld an- oder ausschalten',
    })

    return next(e)
  })

  on('command.run', { command: 'verbessern' }, async $ => {
    await toggleEnabled($)
    const isOn = await read($, enabled)

    return { text: isOn ? 'Prompt-Verbesserer ist an.' : 'Prompt-Verbesserer ist aus.' }
  })

  // Merken, ob ein Entwurf im Eingabefeld steht (nur bei Wechsel schreiben).
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    if (!(await read($, editSeen))) await update($, editSeen, () => true)
    const has = r.text.trim().length > 0
    if ((await read($, hasDraft)) !== has) await update($, hasDraft, () => has)

    return r
  })

  // Gesendet: Rueckgaengig gilt nicht mehr, Entwurf ist weg.
  on('prompt.submit', async ($, e, next) => {
    await update($, original, () => '')
    await update($, hasDraft, () => false)

    return next(e)
  })

  // Nur EIN Band ueber dem Prompt: darunterliegendes Band durchreichen, unseres
  // anhaengen.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props?.hasSurvey) return below
    if (!(await read($, enabled))) return below

    const isBusy = await read($, busy)
    const draft = (await read($, hasDraft)) || !(await read($, editSeen))
    const old = await read($, original)
    if (!isBusy && !draft && !old) return below

    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {below}
        <Box gap={1}>
          <Text color="magenta">{'✨'}</Text>
          {isBusy ? <Text dimColor>verbessert den Prompt ...</Text> : null}
          {isBusy ? (
            <Button key="cancel" label="abbrechen" onPress={() => void cancel($)} />
          ) : null}
          {!isBusy && draft ? (
            <Button key="boost" label="Prompt verbessern" onPress={() => void boost($)} />
          ) : null}
          {!isBusy && old ? (
            <Button key="undo" label="rueckgaengig" onPress={() => void undo($)} />
          ) : null}
        </Box>
      </Box>
    )
  })
}
