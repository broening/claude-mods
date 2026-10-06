import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Rest-Warmzeit des 1-Stunden-Prompt-Cache ueber dem Prompt anzeigen, als
// Ampel: gruen (warm), orange (bald kalt), rot (kalt). Dazu ein Compact-Knopf
// und ein Auto-Schalter (an/aus).
//
// AUTOMATIK: Wenn der Auto-Schalter an ist, verdichtet der Mod 2 Minuten bevor
// der Cache kalt wird von selbst, damit die naechste Nachricht nicht die ganze
// grosse Unterhaltung zum vollen Preis neu schickt. Einmal pro Leerlauf.
// Schalter aus = kein automatisches Verdichten (wenn du fertig bist).
//
// Die Cache-API gibt die echte Restzeit nicht her, also zaehlen wir selbst:
// jede fertige Antwort = frischer Request = Cache wieder warm.

const TTL_MS = 60 * 60 * 1000 // 1 Stunde (Abo). Bei API-Key waeren es 5 Min.
const WARN_MS = 15 * 60 * 1000 // ab hier "bald kalt" (orange)
const AUTO_COMPACT_MS = 2 * 60 * 1000 // 2 Min vor kalt automatisch verdichten
const BAR_WIDTH = 10

const GREEN = '#22c55e'
const ORANGE = '#f59e0b'
const RED = '#ef4444'
const GREY = '#9ca3af'

const lastActivity = atom(
  { plugin: 'cache-countdown', key: 'lastActivity' } as const,
  0,
)
// Nur zum periodischen Neuzeichnen, damit die Uhr auch im Leerlauf tickt.
const tick = atom({ plugin: 'cache-countdown', key: 'tick' } as const, 0)
// Auto-Compact an/aus (pro Sitzung, Start = an).
const autoCompact = atom(
  { plugin: 'cache-countdown', key: 'autoCompact' } as const,
  true,
)

// Scharf, solange noch nicht in diesem Leerlauf automatisch verdichtet wurde.
let armed = true

function cacheState(
  nowMs: number,
  lastMs: number,
): { phrase: string; color: string; frac: number } {
  if (!lastMs) return { phrase: '--', color: GREY, frac: 0 }
  const remainMs = Math.max(0, TTL_MS - (nowMs - lastMs))
  const m = Math.floor(remainMs / 60000)
  const frac = remainMs / TTL_MS
  if (remainMs <= 0) return { phrase: 'kalt', color: RED, frac: 0 }
  if (remainMs <= WARN_MS) {
    return { phrase: `${m}m bald kalt`, color: ORANGE, frac }
  }
  return { phrase: `${m}m warm`, color: GREEN, frac }
}

// Verdichten. In der Desktop-App (SDK-Sitzung) gibt es $.session.compact()
// nicht; dann laeuft der eingebaute /compact-Befehl (wartet, bis Claude frei ist).
async function compactNow($: EngineInterface): Promise<void> {
  try {
    await $.session.compact()
  } catch {
    await $.command.run({ command: 'compact' })
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, lastActivity, () => now)
    armed = true

    // Gemerkten Auto-Schalter laden (sitzungsuebergreifend). Standard = an.
    const savedAuto = await $.store.get('autoCompact')
    await update($, autoCompact, () => (savedAuto === false ? false : true))

    // Alle 30s: neu zeichnen und pruefen, ob automatisch verdichtet werden muss.
    $.clock.every(30_000, async () => {
      void update($, tick, n => n + 1)

      if (!(await read($, autoCompact))) return

      const lastMs = await read($, lastActivity)
      if (!lastMs) return

      const remainMs = Math.max(0, TTL_MS - ((await $.clock.now()) - lastMs))

      if (armed && remainMs > 0 && remainMs <= AUTO_COMPACT_MS) {
        armed = false
        $.ui.toast('Cache fast kalt - verdichte automatisch, um Tokens zu sparen')
        try {
          await compactNow($)
          // Verdichten ist ein frischer Request -> Cache wieder warm.
          const after = await $.clock.now()
          await update($, lastActivity, () => after)
        } catch (err) {
          $.ui.toast(`Auto-Compact fehlgeschlagen: ${String(err)}`)
        } finally {
          armed = true
        }
      }
    })

    await $.command.register({
      name: 'compact-cache',
      description: 'Unterhaltung verdichten, um den Prompt-Cache zu sparen',
    })

    return next(e)
  })

  // Jede fertige Antwort haelt den Cache warm -> Uhr zuruecksetzen, Automatik neu scharf.
  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    await update($, lastActivity, () => now)
    armed = true

    return next(e)
  })

  // Band ueber dem Prompt. Nur EIN Band ("one instance"), darum reichen wir das
  // darunterliegende Band (below) durch und haengen unseres an.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) {
      return below
    }

    await read($, tick) // abonnieren, damit der Timer neu zeichnet
    const lastMs = await read($, lastActivity)
    const now = await $.clock.now()
    const auto = await read($, autoCompact)

    const { phrase, color, frac } = cacheState(now, lastMs)
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(frac * BAR_WIDTH)))
    const fill = '█'.repeat(filled)
    const track = '░'.repeat(BAR_WIDTH - filled)

    const { Box, Text, Button } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
      {below}
      <Box>
        <Text color={color}>{'●'} {phrase}  </Text>
        <Text color={color}>{fill}</Text>
        <Text dimColor>{track}</Text>
        <Text>{'  '}</Text>
        <Button
          key="compact"
          label="Compact"
          onPress={() => {
            $.ui.toast('Verdichte die Unterhaltung ...')
            compactNow($).catch(err =>
              $.ui.toast(`Compact fehlgeschlagen: ${String(err)}`),
            )
          }}
        />
        <Text>{' '}</Text>
        <Button
          key="auto"
          label={auto ? 'Auto: an' : 'Auto: aus'}
          onPress={() => {
            const nextAuto = !auto
            void update($, autoCompact, () => nextAuto)
            void $.store.set('autoCompact', nextAuto) // sitzungsuebergreifend merken
            $.ui.toast(
              nextAuto ? 'Auto-Compact eingeschaltet' : 'Auto-Compact ausgeschaltet',
            )
          }}
        />
      </Box>
      </Box>
    )
  })

  // /compact-cache
  // Erst nach diesem Befehl verdichten (clock.after), sonst wartet der Befehl
  // auf sich selbst.
  on('command.run', { command: 'compact-cache' }, async $ => {
    $.clock.after(500, () =>
      compactNow($).catch(err =>
        $.ui.toast(`Compact fehlgeschlagen: ${String(err)}`),
      ),
    )

    return { text: 'Verdichte die Unterhaltung ...' }
  })
}
