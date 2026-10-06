import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Task } from '../types'

// Arbeitsliste im Seitenfenster. Dan reiht Aufgaben ein, ohne Claude bei der
// laufenden Arbeit zu unterbrechen (Eingabefeld oder "/todo <text>").
//
// EIN Schalter: Automatik.
//   Auto an  = die Liste wird von allein abgearbeitet, Aufgabe fuer Aufgabe
//              (z.B. ueber Nacht). Nach jeder fertigen Antwort startet die
//              naechste offene Aufgabe.
//   Auto aus = es laeuft NICHTS von selbst. Nur der ▶-Knopf startet genau eine
//              Aufgabe; danach ist Schluss, es wird nicht weitergemacht.
//
// Jede gestartete Aufgabe geht als eigener Prompt an Claude; ist die Antwort
// fertig, wird die Aufgabe abgehakt. Erledigtes bleibt unten sichtbar. Die
// Liste bleibt ueber Sitzungen hinweg erhalten.

const PANE = 'todo-list'
const PANE_TITLE = 'Arbeitsliste'
const GREEN = '#22c55e'

// Aufgaben: Atom (zeichnet das Fenster neu) + Store (bleibt dauerhaft).
const tasks = atom({ plugin: 'todo-list', key: 'tasks' } as const, [] as Task[])
// Die Aufgabe, an der Claude gerade arbeitet. Nur pro Sitzung.
const activeId = atom(
  { plugin: 'todo-list', key: 'activeId' } as const,
  null as string | null,
)
// Automatik: Liste von allein abarbeiten. Wird gespeichert.
const auto = atom({ plugin: 'todo-list', key: 'auto' } as const, false)
// Welche Aufgabe wird gerade im Feld bearbeitet? Nur pro Sitzung.
const editingId = atom(
  { plugin: 'todo-list', key: 'editingId' } as const,
  null as string | null,
)
// Aktueller Text im Eingabefeld. Nach dem Einreihen wird er geleert.
const draft = atom({ plugin: 'todo-list', key: 'draft' } as const, '')

// Sicherheit gegen Endlosschleifen: hoechstens so viele Aufgaben am Stueck
// automatisch starten, dann Auto abschalten. Zaehler pro Sitzung.
const AUTO_LIMIT = 25
let autoRuns = 0

// Prueft beim Laden aus dem Store, dass wirklich eine Liste gueltiger Aufgaben
// da ist. Alte Aufgaben ohne createdAt/doneAt bekommen Standardwerte.
function cleanTasks(raw: unknown, now: number): Task[] {
  if (!Array.isArray(raw)) return []

  const out: Task[] = []
  for (const t of raw) {
    if (
      !t ||
      typeof t !== 'object' ||
      typeof (t as Task).id !== 'string' ||
      typeof (t as Task).text !== 'string' ||
      typeof (t as Task).done !== 'boolean'
    ) {
      continue
    }
    const one = t as Partial<Task> & Pick<Task, 'id' | 'text' | 'done'>
    out.push({
      id: one.id,
      text: one.text,
      done: one.done,
      createdAt: typeof one.createdAt === 'number' ? one.createdAt : now,
      doneAt:
        typeof one.doneAt === 'number' ? one.doneAt : one.done ? now : null,
    })
  }

  return out
}

// Liste aendern: Atom und Store zusammen, damit nichts auseinanderlaeuft.
async function setTasks($: EngineInterface, fn: (list: Task[]) => Task[]) {
  const next = fn(await read($, tasks))
  await update($, tasks, () => next)
  await $.store.set('tasks', next)

  return next
}

// Neue Aufgabe hinten anreihen. Schickt nie einen Prompt, stoert Claude also nicht.
async function addTask($: EngineInterface, raw: string) {
  const text = raw.trim()
  if (!text) return
  const now = await $.clock.now()
  const id = `${now}-${Math.random().toString(36).slice(2)}`
  await setTasks($, list => [
    ...list,
    { id, text, done: false, createdAt: now, doneAt: null },
  ])
  autoRuns = 0 // neue Arbeit -> Sicherheits-Zaehler zuruecksetzen
  $.ui.toast('Eingereiht')
}

// Bearbeiteten Text einer Aufgabe speichern. Leerer Text: nur das Feld zu.
async function saveEdit($: EngineInterface, id: string, raw: string) {
  const text = raw.trim()
  await update($, editingId, () => null)
  if (!text) return
  await setTasks($, list =>
    list.map(t => (t.id === id ? { ...t, text } : t)),
  )
}

// Aufgabe von Hand ab- oder wieder anhaken (Kaestchen).
async function toggleDone($: EngineInterface, id: string) {
  const now = await $.clock.now()
  await setTasks($, list =>
    list.map(t =>
      t.id === id
        ? { ...t, done: !t.done, doneAt: !t.done ? now : null }
        : t,
    ),
  )
}

// Eine Aufgabe als aktuelle setzen und an Claude schicken.
async function startTask($: EngineInterface, task: Task) {
  await update($, activeId, () => task.id)
  await $.prompt.submit({ text: task.text })
}

// Naechste offene Aufgabe starten, wenn eine da ist. Gibt true zurueck, wenn
// gestartet wurde.
async function startNext($: EngineInterface): Promise<boolean> {
  const first = (await read($, tasks)).find(t => !t.done)
  if (!first) return false
  await startTask($, first)

  return true
}

// Automatik umschalten. Beim Einschalten die erste offene Aufgabe starten,
// wenn gerade nichts laeuft.
async function toggleAuto($: EngineInterface) {
  const next = !(await read($, auto))
  await update($, auto, () => next)
  await $.store.set('auto', next)
  $.ui.toast(next ? 'Automatik an' : 'Automatik aus')
  if (next) {
    autoRuns = 0 // frischer Lauf -> Sicherheits-Zaehler zuruecksetzen
    if ((await read($, activeId)) === null) await startNext($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    const saved = cleanTasks(await $.store.get('tasks'), now)
    await update($, tasks, () => saved)
    const savedAuto = (await $.store.get('auto')) === true
    await update($, auto, () => savedAuto)
    await $.command.register({
      name: 'todo',
      description:
        'Arbeitsliste: ohne Text oeffnen, mit "/todo <text>" eine Aufgabe einreihen',
    })
    // Fenster NICHT automatisch oeffnen - erscheint erst auf "/todo".

    return next(e)
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.trim()
    if (!text) {
      await $.ui.open({ id: PANE, title: PANE_TITLE })

      return { text: 'Arbeitsliste geoeffnet.' }
    }
    await addTask($, text)
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Eingereiht: ' + text }
  })

  on('turn.complete', async ($, e, next) => {
    // Nur die Hauptschleife zaehlt, nicht Subagenten.
    if (e.agentId) return next(e)

    const current = await read($, activeId)
    // War keine Listen-Aufgabe aktiv, macht die Liste gar nichts (kein
    // Selbstlauf, keine Nachfrage).
    if (current === null) return next(e)

    // Unterbrochen oder Fehler: Aufgabe bleibt offen, nichts geht weiter.
    if (e.reason !== 'answer') {
      await update($, activeId, () => null)

      return next(e)
    }

    // Aufgabe fertig: abhaken.
    const now = await $.clock.now()
    await setTasks($, list =>
      list.map(t => (t.id === current ? { ...t, done: true, doneAt: now } : t)),
    )
    await update($, activeId, () => null)

    // Nur mit Automatik an geht es zur naechsten Aufgabe weiter.
    if (await read($, auto)) {
      autoRuns += 1
      if (autoRuns > AUTO_LIMIT) {
        // Sicherheits-Stopp gegen Endlosschleifen.
        await update($, auto, () => false)
        await $.store.set('auto', false)
        autoRuns = 0
        $.ui.toast(
          'Sicherheits-Stopp: ' + AUTO_LIMIT + ' Aufgaben am Stueck. Auto ist aus.',
        )
      } else {
        const gestartet = await startNext($)
        if (!gestartet) {
          autoRuns = 0
          $.ui.toast('Arbeitsliste abgearbeitet.')
        }
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const list = await read($, tasks)
    const active = await read($, activeId)
    const isAuto = await read($, auto)
    const editing = await read($, editingId)
    const draftText = await read($, draft)

    const open = list.filter(t => !t.done)
    const done = list
      .filter(t => t.done)
      .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0))

    // Claude arbeitet an der Liste, wenn gerade eine Aufgabe aktiv ist.
    const busy = active !== null

    // Platz fuer Kopf, Knopfzeile, Eingabe, offene Aufgaben und Rand abziehen.
    const doneRoom = Math.max(1, (e.viewport?.rows ?? 24) - 12 - open.length)
    const hidden = done.length - doneRoom

    return (
      <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
        <Box flexDirection="column">
          {busy ? (
            <Text dimColor>{'◆'} Claude arbeitet an der Liste</Text>
          ) : (
            <Text color={GREEN}>{'◆'} Claude ist frei</Text>
          )}
          <Text dimColor>
            {isAuto
              ? 'Automatik an: offene Aufgaben starten von allein.'
              : 'Automatik aus: nichts laeuft von selbst. Mit ▶ startest du eine.'}
          </Text>
        </Box>

        <Box gap={1}>
          <Button
            key="auto"
            label={isAuto ? 'Auto: an' : 'Auto: aus'}
            onPress={() => void toggleAuto($)}
          />
          <Button
            key="clear-done"
            label="Erledigte weg"
            onPress={() => void setTasks($, l => l.filter(t => !t.done))}
          />
        </Box>

        <Box flexDirection="column" gap={1}>
          <Text bold>Deine Warteschlange - {open.length} offen</Text>
          <Input
            key="add"
            placeholder="neue Aufgabe, Enter"
            submitLabel="einreihen"
            autoFocus
            value={draftText}
            onInput={value => void update($, draft, () => value)}
            onSubmit={value => {
              void addTask($, value)
              void update($, draft, () => '')
            }}
          />
          <Box flexDirection="column">
            {open.length === 0 && <Text dimColor>Noch leer.</Text>}
            {open.map(task => {
              const isActive = task.id === active

              if (task.id === editing) {
                return (
                  <Box key={'row-' + task.id} gap={1} alignItems="flex-start">
                    <Input
                      key={'edit-' + task.id}
                      value={task.text}
                      submitLabel="speichern"
                      autoFocus
                      onSubmit={value => void saveEdit($, task.id, value)}
                    />
                    <Button
                      key={'cancel-' + task.id}
                      label="Abbrechen"
                      onPress={() => void update($, editingId, () => null)}
                    />
                  </Box>
                )
              }

              return (
                <Box key={'row-' + task.id} gap={1} alignItems="flex-start">
                  <Button
                    key={'chk-' + task.id}
                    label={'☐'}
                    onPress={() => void toggleDone($, task.id)}
                  />
                  <Button
                    key={'go-' + task.id}
                    label={'▶'}
                    onPress={() => void startTask($, task)}
                  />
                  <Button
                    key={'edit-btn-' + task.id}
                    label={'✎'}
                    onPress={() => void update($, editingId, () => task.id)}
                  />
                  <Button
                    key={'del-' + task.id}
                    label={'\u{1F5D1}'}
                    onPress={() => {
                      void setTasks($, l => l.filter(t => t.id !== task.id))
                      if (active === task.id) void update($, activeId, () => null)
                      if (editing === task.id)
                        void update($, editingId, () => null)
                    }}
                  />
                  <Text bold={isActive} color={isActive ? GREEN : undefined}>
                    {task.text}
                  </Text>
                </Box>
              )
            })}
          </Box>
        </Box>

        {done.length > 0 && (
          <Box flexDirection="column" gap={1}>
            <Text bold>Erledigt - {done.length}</Text>
            <Box flexDirection="column">
              {done.slice(0, doneRoom).map(task => (
                <Box key={'done-' + task.id} gap={1} alignItems="flex-start">
                  <Button
                    key={'undone-' + task.id}
                    label={'☑'}
                    onPress={() => void toggleDone($, task.id)}
                  />
                  <Text dimColor strikethrough>
                    {task.text}
                  </Text>
                </Box>
              ))}
              {hidden > 0 && <Text dimColor>... und {hidden} weitere</Text>}
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
