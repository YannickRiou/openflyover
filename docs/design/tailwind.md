# Design: styling on Tailwind CSS

Status: accepted. Target: v2.0.0 (after v1.0.0). Prerequisite of [heroui.md](heroui.md).

## Why

The interface is styled by 27 hand-written CSS files (about 5,500 lines) on top of the tokens of
`src/ui/theme.css`. Spacing, sizes and radii are chosen file by file, which makes the look drift and every
new screen slower to build. [Tailwind CSS](https://tailwindcss.com) v4 (MIT, 4.3.3 at the time of writing)
gives one shared scale for spacing, type, colour and radius, generates only the classes in use, and is the
styling layer HeroUI requires (`tailwindcss >= 4` peer dependency).

The goal is a **more professional, more consistent look with the same identity and the same features**: same
palette, same fonts, same layout (rail, scene, timeline, export drawer), same French labels through the i18n keys.

## Fit with the two targets

- Build-time only: the `@tailwindcss/vite` plugin (supports Vite 8) emits a static CSS file. No runtime, no
  network, nothing added to the Tauri shell; the hosted static site and the desktop app keep the same build.
- No content from a CDN: everything is bundled, offline use is unchanged.
- Free and open only: the MIT `tailwindcss` packages; no paid kit (Tailwind Plus or similar), no hosted service.
  Every token and utility is defined in the repository and can be changed there.

## Rules

- **Tokens stay the source of truth.** `theme.css` declares the existing palette, fonts, radii and shadows
  in a Tailwind `@theme` block, so `bg-*`, `text-*`, `rounded-*` utilities resolve to the current colours.
  No colour outside the palette; contrast ≥ 4.5:1 checked for each pair used.
- **Light and dark themes** keep `:root[data-theme]`: a `@custom-variant dark` bound to
  `[data-theme='dark']` replaces the current duplicated selectors.
- **Readable JSX.** Utilities for layout and spacing in `className`; a combination repeated more than twice
  becomes a component (or a `@utility` / `@layer components` class), never a copy-pasted string. Class
  order sorted automatically (Prettier plugin or the ESLint rule, whichever the repo already runs).
- **Cohabitation during the migration.** The existing CSS moves into `@layer components` so utilities win
  where both apply; Tailwind's Preflight reset is enabled from step 1 and its visual differences fixed there.
- **Stable test hooks.** End-to-end and unit selectors that use styling classes (`.toast`,
  `.setting-row__head`, `.segmented`…) move to roles, labels or `data-testid` before the class disappears.
- A CSS file is deleted only when nothing references it any more; no dead CSS left behind.

## Order (one pull request each)

1. Add `tailwindcss` + `@tailwindcss/vite`, map `theme.css` tokens into `@theme`, dark variant, Preflight;
   existing CSS into `@layer components`. No visual change expected beyond reset fixes.
2. Move test selectors off styling classes.
3. Shell: top bar, rail, panels (`shell.css`, `PanelSection`, `SettingRow`).
4. Inspector panels one by one (track, camera, light, overlay, landmarks, weather…).
5. Timeline and export drawer.
6. Dialogs, toasts, home screen; delete the emptied CSS files.

Each step: `npm run typecheck`, `npm run lint`, `npx vitest run --maxWorkers=1`, `npm run build` and the
end-to-end scenarios (`OPENFLYOVER_E2E_SKIP_EXPORT=1 npm run e2e`) pass; before/after screenshots (light, dark,
phone width) and CSS bundle size in the pull request.

## Risks

- Long `className` strings hurt readability for a developer new to the web: mitigated by the component rule above.
- A large, mostly visual diff per step: steps are kept to one area of the screen so review stays possible.
- Preflight changes default margins, borders and form controls: handled once in step 1.
