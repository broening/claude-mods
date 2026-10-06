import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

// Blast Radius: haelt gefaehrliche Shell-Befehle (Bash und PowerShell) an,
// bevor sie laufen. Trifft ein Befehl eine Gefahrenregel, zeigt der Mod den
// Befehl samt Folge und fragt Dan. "Abbrechen" verweigert den Aufruf,
// "Trotzdem ausfuehren" laesst ihn durch. Alles andere laeuft ohne Reibung.
// Standard: AUS. "/ward" schaltet die Wache fuer diese Sitzung an (nochmal: aus).
// Jede neue Sitzung startet wieder mit "aus".

const ASK_CANCEL = 'Abbrechen'
const ASK_RUN = 'Trotzdem ausfuehren'

// Wache an oder aus, nur fuer diese Sitzung.
const enabled = atom({ plugin: 'blast-radius', key: 'enabled' } as const, false)

// Die Regeln, genau in dieser Reihenfolge. Die erste Uebereinstimmung gewinnt.
const REGELN: { re: RegExp; grund: string }[] = [
  { re: /\brm\s+-\S*[rf]/i,                       grund: 'rm loescht Dateien/Ordner unwiderruflich (rekursiv oder erzwungen).' },
  { re: /\bremove-item\b[^\n]*-(recurse|force)/i, grund: 'Remove-Item loescht rekursiv oder erzwungen.' },
  { re: /\b(rmdir|rd)\b[^\n]*\/s/i,               grund: 'rmdir /s loescht einen Ordner mit ganzem Inhalt.' },
  { re: /\bdel\b[^\n]*\/s/i,                       grund: 'del /s loescht Dateien in allen Unterordnern.' },
  { re: /\bgit\s+reset\s+--hard/i,                grund: 'git reset --hard verwirft lokale Aenderungen.' },
  { re: /\bgit\s+clean\s+-\S*f/i,                 grund: 'git clean -f loescht ungetrackte Dateien.' },
  { re: /\bgit\s+push\b[^\n]*(--force|-f\b)/i,    grund: 'git push --force ueberschreibt den Remote-Verlauf.' },
  { re: /\bgit\s+branch\s+-D\b/i,                 grund: 'git branch -D loescht einen Branch hart.' },
  { re: /\bdd\b[^\n]*\bof=/i,                     grund: 'dd kann einen Datentraeger ueberschreiben.' },
  { re: /\bmkfs\b/i,                              grund: 'mkfs formatiert ein Dateisystem.' },
  { re: /\bformat\b[^\n]*:/i,                     grund: 'format formatiert ein Laufwerk.' },
  { re: /\bchmod\s+-\S*R/i,                       grund: 'chmod -R aendert Rechte ganzer Verzeichnisbaeume.' },
  { re: /\bchown\s+-\S*R/i,                       grund: 'chown -R aendert Eigentuemer ganzer Verzeichnisbaeume.' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i,  grund: 'faehrt das System herunter oder startet neu.' },
  { re: /\b(stop-computer|restart-computer)\b/i, grund: 'faehrt Windows herunter oder startet neu.' },
  { re: /\bdrop\s+(table|database)\b/i,           grund: 'SQL DROP loescht eine Tabelle oder Datenbank.' },
  { re: /\btruncate\s+table\b/i,                  grund: 'SQL TRUNCATE leert eine Tabelle.' },
]

// Gibt den deutschen Grund der ersten passenden Regel zurueck, sonst null.
function gefahr(cmd: string): string | null {
  for (const regel of REGELN) {
    if (regel.re.test(cmd)) return regel.grund
  }

  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // Alter Dauer-Schalter von /blast: loeschen, damit nichts mehr "an" erzwingt.
    await $.store.delete('enabled')
    await update($, enabled, () => false)
    await $.command.register({
      name: 'ward',
      description: 'Blast Radius fuer diese Sitzung an- oder ausschalten (Rueckfrage vor gefaehrlichen Befehlen)',
    })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)

    const cmd = typeof e.command === 'string' ? e.command : ''
    if (!cmd) return next(e)
    if (!(await read($, enabled))) return next(e)

    const grund = gefahr(cmd)
    if (grund === null) return next(e)

    const antwort = await $.ui.ask(
      `Gefaehrlicher Befehl:\n${cmd}\n\n${grund}`,
      [ASK_CANCEL, ASK_RUN],
    )
    if (antwort === ASK_RUN) return next(e)

    $.ui.toast('Befehl gestoppt.')

    return { deny: `Vom Blast-Radius-Mod gestoppt: ${grund}` }
  })

  on('command.run', { command: 'ward' }, async $ => {
    const neu = !(await read($, enabled))
    await update($, enabled, () => neu)

    return { text: neu ? 'Blast Radius ist an.' : 'Blast Radius ist aus.' }
  })
}
