<#
.SYNOPSIS
  Traegt die Mods aus diesem Ordner in ~/.claude/settings.json ein.

.DESCRIPTION
  Setzt env.CLAUDE_CODE_PLUGIN_DIRS auf alle Mod-Ordner hier (jeder Ordner mit
  .claude-plugin/plugin.json). Andere Eintraege in settings.json bleiben.
  Vorher wird eine Sicherung settings.json.bak angelegt.
  Danach Claude Code neu starten.

.EXAMPLE
  .\install.ps1
  .\install.ps1 -Only cache-countdown,blast-radius
#>
param(
  [string[]]$Only
)

$ErrorActionPreference = 'Stop'

$modsRoot = $PSScriptRoot
$settingsPath = Join-Path $env:USERPROFILE '.claude\settings.json'

$mods = Get-ChildItem -Path $modsRoot -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName '.claude-plugin\plugin.json') }
if ($Only) {
  $mods = $mods | Where-Object { $Only -contains $_.Name }
}
if (-not $mods) {
  throw "Keine Mods gefunden in $modsRoot"
}

$dirs = ($mods | ForEach-Object { $_.FullName }) -join ';'

if (Test-Path $settingsPath) {
  Copy-Item $settingsPath "$settingsPath.bak" -Force
  $settings = Get-Content $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
} else {
  New-Item -ItemType Directory -Force (Split-Path $settingsPath) | Out-Null
  $settings = [pscustomobject]@{}
}

if (-not $settings.PSObject.Properties['env']) {
  $settings | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{})
}
if ($settings.env.PSObject.Properties['CLAUDE_CODE_PLUGIN_DIRS']) {
  $settings.env.CLAUDE_CODE_PLUGIN_DIRS = $dirs
} else {
  $settings.env | Add-Member -NotePropertyName CLAUDE_CODE_PLUGIN_DIRS -NotePropertyValue $dirs
}

# UTF-8 ohne BOM, damit Claude Code die Datei sicher liest
$json = $settings | ConvertTo-Json -Depth 100
[System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Host "Eingetragen in $settingsPath :"
$mods | ForEach-Object { Write-Host "  - $($_.Name)" }
Write-Host 'Claude Code jetzt neu starten.'
