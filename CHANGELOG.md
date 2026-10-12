# Changelog

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/). Jeder Mod hat seine eigene Version in `plugin.json`.

## 2026-10-12

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
