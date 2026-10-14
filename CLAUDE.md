# OpenFlyover

3D flyover film viewer / generator from GPX and FIT files, 100% local.

- Two targets; always keep both working: hosted static website (no application server) and
  desktop application (Tauri, phase 6). No Node dependency at runtime; disk access and storage behind a
  common interface (browser / Tauri).

- Read `ARCHITECTURE.md` before touching the code: coordinate conventions, contracts (`src/core/types.ts`), modules.
- Under WSL: Node 24 via nvm, prefix with `source ~/.nvm/nvm.sh && nvm use 24`. Tests: `npx vitest run --maxWorkers=1`.
- On Windows, Node is not in the global PATH. Prefix the commands:
  - PowerShell: `$env:Path = "C:\Users\MadCreator\AppData\Roaming\fnm\node-versions\v24.21.0\installation;" + $env:Path; npm test`
  - Bash: `export PATH="/c/Users/MadCreator/AppData/Roaming/fnm/node-versions/v24.21.0/installation:$PATH"; npm test`
- Scripts: `npm run dev`, `npm run build`, `npm test`, `npm run typecheck`, `npm run lint`.
- No API key, no paid service: only open sources without a key (open tiles, Open-Meteo weather archives, OpenStreetMap via Overpass), with caching and respect for their terms of use.
- UI in French (the reference, default) and English: no displayed text in the code, every string goes through `t('domain.key')` with a message in `src/i18n/fr/` and `src/i18n/en/` (`ARCHITECTURE.md`, « Internationalisation »). Visual identity in `src/ui/theme.css`.
- Documentation (README, ARCHITECTURE, docs/) is written in English; UI labels quoted from the app stay in French.
- Strict TypeScript with `verbatimModuleSyntax` (use `import type`) and `erasableSyntaxOnly` (no `enum`, no constructor parameter properties).
- Sub-agents: only when really needed (broad exploration, truly independent parallel work), always on the Sonnet 5.5 model (`model: "sonnet"`), to keep token use low. Sub-agents run no git command; the main session commits.
