# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/). Jeder Mod hat seine eigene Version in `plugin.json`.

## 2026-10-12

### sitzungs-waechter 0.1.0 (neu)
- Warnt mit einem Band über dem Prompt (und einmal als Toast), wenn eine zweite Sitzung im selben Ordner läuft.
- Jede Sitzung trägt sich alle 30 Sekunden in `~/.claude/sitzungs-waechter.json` ein. Ohne Lebenszeichen seit 90 Sekunden gilt sie als beendet.
- **ok** blendet die Warnung aus, bis eine weitere Sitzung dazukommt.

### prompt-boost 0.1.0 (neu)
- Band über dem Eingabefeld mit **Prompt verbessern**: schreibt den Entwurf besser um und ersetzt ihn im Eingabefeld. Sendet nichts.
- **rueckgaengig** holt den alten Entwurf zurück. Tippt man währenddessen weiter, wird nichts ersetzt.
- `/verbessern` schaltet den Mod an oder aus (wird gespeichert).

### next-steps 0.2.0, annahmen 0.2.0
- Eine Modell-Anfrage statt zwei: next-steps holt nach jeder Antwort Schritte **und** Annahmen mit einem Fork. Spart Tokens.
- annahmen übernimmt die Annahmen von next-steps. Ist next-steps aus (`/vorschlaege`) oder nicht installiert, fragt annahmen selbst.
- annahmen braucht jetzt next-steps (`dependencies`).
- Tests für beide Mods.

### annahmen 0.1.0 (neu)
- Band über dem Prompt mit den stillen Annahmen von Claude nach jeder Antwort.
- Je Annahme **richtig** / **falsch**, optionale Notiz, **Korrektur senden** schickt einen neuen Auftrag.
- `/annahmen` schaltet den Mod an oder aus (wird gespeichert).

## 2026-10-06

### cache-countdown 0.2.0
- Behoben: **Compact**-Knopf, Auto-Compact und `/compact-cache` taten in der Desktop-App nichts. `$.session.compact()` gibt es dort nicht. Jetzt läuft als Ersatz der eingebaute `/compact`-Befehl.
- Behoben: Nach einem Fehler blieb Auto-Compact für die ganze Sitzung aus.
- Fehler beim Verdichten erscheinen als Toast.

### blast-radius 0.2.0
- Standard ist jetzt **aus**. `/ward` schaltet die Wache für die Sitzung an oder aus.
- `/blast` entfernt.

### next-steps 0.1.1, todo-list 0.2.1
- Beschreibung in `plugin.json` an das aktuelle Verhalten angepasst.

## 2026-10-05
- Erste Fassung aller fünf Mods: cache-countdown, blast-radius, next-steps, todo-list, grill.
