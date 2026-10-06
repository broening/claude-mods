# claude-mods

Mods für [Claude Code](https://claude.com/claude-code). Jeder Mod ist ein kleines Plugin aus TypeScript-Hooks. Er ändert Claude Code von innen: ein Band über dem Eingabefeld, ein Seitenfenster, eigene Slash-Befehle oder eine Rückfrage vor Tool-Aufrufen.

[![Mods prüfen](https://github.com/broening/claude-mods/actions/workflows/validate.yml/badge.svg)](https://github.com/broening/claude-mods/actions/workflows/validate.yml)

## Die Mods

| Mod | Was er macht | Befehl |
|---|---|---|
| [cache-countdown](cache-countdown) | Zeigt über dem Prompt, wie lange der Prompt-Cache (1 Stunde) noch warm ist: grün, orange ab 15 Min, rot wenn kalt. Knopf **Compact** und Schalter **Auto**: verdichtet 2 Minuten vor kalt von selbst. | `/compact-cache` |
| [blast-radius](blast-radius) | Hält gefährliche Shell-Befehle (Bash und PowerShell) an, zum Beispiel `rm -rf`, `Remove-Item -Recurse`, `git reset --hard`, `git push --force`, `DROP TABLE`. Fragt vor dem Ausführen nach. Standard aus. | `/ward` an/aus |
| [next-steps](next-steps) | Schlägt nach jeder Antwort drei nächste Schritte vor. Ein Klick schickt den Schritt als Prompt. | `/vorschlaege` |
| [todo-list](todo-list) | Arbeitsliste im Seitenfenster. Aufgaben einreihen, ohne Claude zu unterbrechen. Mit **Auto** arbeitet Claude sie nacheinander ab. | `/todo` |
| [grill](grill) | Stellt bis zu 5 Rückfragen zu deinem Plan, eine nach der anderen, mit Antwortknöpfen und KI-Vorschlag. | `/grill [thema]` |

Hinweis: next-steps und grill rufen das Modell zusätzlich auf (`$.model.fork`). Das kostet etwas Kontingent.

## Voraussetzungen

- Claude Code mit Mod-Unterstützung (getestet mit 2.1.287)
- Git
- Windows: PowerShell 5.1 oder neuer. macOS und Linux: siehe unten.

## Installieren (neuer Rechner)

Unter Windows in PowerShell:

```powershell
git clone https://github.com/broening/claude-mods.git "$env:USERPROFILE\.claude\mods"
```

```powershell
& "$env:USERPROFILE\.claude\mods\install.ps1"
```

Danach Claude Code neu starten. Das Skript trägt alle Mod-Ordner in `~/.claude/settings.json` unter `env.CLAUDE_CODE_PLUGIN_DIRS` ein. Andere Einstellungen bleiben. Eine Sicherung liegt danach in `settings.json.bak`.

Nur einzelne Mods:

```powershell
& "$env:USERPROFILE\.claude\mods\install.ps1" -Only cache-countdown,blast-radius
```

macOS und Linux: Repo nach `~/.claude/mods` klonen und in `~/.claude/settings.json` eintragen (Trennzeichen `:`):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "/home/<du>/.claude/mods/cache-countdown:/home/<du>/.claude/mods/blast-radius"
  }
}
```

### Alternative: als Plugin-Marktplatz

Das Repo ist auch ein Claude-Code-Marktplatz (`.claude-plugin/marketplace.json`). In Claude Code:

```text
/plugin marketplace add broening/claude-mods
/plugin install cache-countdown@claude-mods
```

Nicht beides gleichzeitig nutzen, sonst lädt ein Mod doppelt.

## Aktualisieren

```powershell
git -C "$env:USERPROFILE\.claude\mods" pull
```

Danach Claude Code neu starten. Kommt ein neuer Mod dazu, `install.ps1` noch einmal ausführen.

## Aufbau eines Mods

```text
<mod>/
  .claude-plugin/plugin.json   Name, Version, Beschreibung
  hooks/hooks.json             { "modules": ["./register.tsx"] }
  hooks/register.tsx           die Hooks: export const register: Register = on => { ... }
  types/index.d.ts             Vertrag für den gespeicherten Zustand ($.state)
  tsconfig.json
```

`.claude-plugin/types/` erzeugt Claude Code bei jedem Build selbst. Der Ordner ist nicht im Repo.

## Entwickeln

1. Mod in seinem Ordner ändern. In einer laufenden Sitzung lädt Claude Code ihn nach dem nächsten Turn neu.
2. Prüfen:

   ```powershell
   claude plugin validate .\cache-countdown
   ```

3. `version` in `plugin.json` erhöhen und einen Eintrag in [CHANGELOG.md](CHANGELOG.md) schreiben.
4. Committen und pushen. GitHub Actions prüft alle Mods bei jedem Push.

Neue Mods am einfachsten mit dem Claude-Code-Skill `plugin-authoring` bauen.

## Lizenz

[MIT](LICENSE)
