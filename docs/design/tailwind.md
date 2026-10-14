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

## Pilot

A first vertical slice was redone in utilities to judge the direction before the rest: the top bar (`TopBar.tsx`,
`LanguageMenu.tsx` button), the rail and the phone bar (`App.tsx`), and the « Trace » tab (`TrackList` header,
`PanelSection`, `SettingRow`, `InfoTip`, `RangeField`, `TextField`, `TrackMarkerSection`). The shell and panel rules
those components used are deleted from `shell.css` and `app.css`.

### Scales and tokens (`theme.css`)

- **Spacing**: Tailwind's 4 px unit (`p-1` = 4 px ... `gap-3` = 12 px, `h-12` = 48 px). The compact density sets
  `--spacing: 3.5px` (`appearance.css`), so every utility follows the density setting.
- **Type**: one scale, `text-caption` 11/16 (rail labels, badges), `text-hint` 12/16 (hints, units), `text-body` 14/20
  (rows, labels, controls), `text-title` 16/24 (section titles, in the heading font). Weights: 400 text and hints, 500
  labels and controls, 600 headings and the primary button. Roles as `@utility`: `type-label`, `type-hint`,
  `panel-title`.
- **Control heights**: `h-control` compact 32 px, `h-control-lg` comfortable 40 px, 44 px for both on a touch screen
  (`--control-h`, `--control-h-lg`; 28 / 36 px in the compact density). Buttons: 40 px, `size="sm"` and icon buttons 32 px.
- **Radii**: `rounded-sm` (6 px) for controls up to 40 px high (buttons, fields, rows), `rounded-md` (10 px) for larger
  blocks (rail tab, panels, cards), `rounded-full` for pills.
- **Roles as colours** (`@theme inline`, so the dark theme remaps them): `bg-chrome`, `bg-surface-panel`,
  `bg-surface-card`, `bg-surface-control`, `text-text-1`, `text-text-2`, `border-edge`, `border-edge-strong`, `bg-brand`
  (the accent as text or mark on a panel), `bg-accent-fill`. On the ink chrome: `text-white`, `text-glacier`, `bg-white/10`
  for hover, `border-white/10` for hairlines.
- **Elevation and borders**: hairlines (`border-edge`, `border-white/10`), `shadow-card` for resting controls,
  `shadow-pop` for floating panels. No heavy outlines.
- **Motion**: `transition-ui` (150 ms, colour / border / shadow / opacity, none under reduced motion).
- **Focus**: one ring, the global `:focus-visible` rule of `theme.css`; on the ink chrome the container carries
  `chrome-focus`, which swaps in the light-accent ring. Components do not draw their own.
- **Breakpoints as variants**: `touch`, `drawer`, `phone`, `phone-any`, `phone-landscape`, `bar-condensed` (the media
  queries of `shell.css`, named once in `theme.css`).

### Conventions

- Layout and spacing in the `className`, in this order: position, box (display, size), spacing, border and radius, colour,
  type, state (`hover:`, `data-[...]:`), responsive (`phone:`, `touch:`). A string used by one component and too long for the
  JSX is a `const` above it with a comment (see `ROW`, `ROW_HEAD` in `PanelSection.tsx`, `NAME_FIELD` in `TopBar.tsx`).
- A combination used by several components is an `@utility` in `src/ui/utilities.css` (`rail-tab`, `btn-chrome`,
  `panel-head`...). Do not put a plain utility next to an `@utility` that sets the same property: the winner is not defined.
  Sizes and colours that differ go in the `@utility` (or a variable it reads), not in an override.
- Styling reads the state attributes of the components (`aria-selected`, `aria-expanded`, `data-selected`, `data-focus-visible`
  from HeroUI) through `data-[...]:` and `group-aria-[...]:`, never extra state classes.
- The primitives stay the place of their skin (`primitives/*.css`: button, chip, switch got the scales above); a screen
  passes utilities for its context only (`btn-chrome`, `labelClassName` of `Radio` for the format switch).
- In an arbitrary variant `_` means a space: write selectors with hyphens (`[&>.field:only-child>label]`), never `__`.
- Test hooks: `data-rail` replaces the `.rail` class where the app looks for the rail; `data-testid`s and labels unchanged.

### What the next areas should copy

1. Section = `panel-head` + `panel-title` (sticky, 48 px), rows of 40 px with a hairline, name left in `type-label`,
   value right in secondary text (primary text and an accent dot once changed), hints in `type-hint`.
2. Other panels (`.settings` cards, `.field__label`, `.field__hint`, `.range-row`, `.preset-more`) still use the hand-written
   classes; `.field__label` and `.section-title` were moved to the new sizes so both look alike meanwhile. Convert them to
   `type-label`, `type-hint` and the row components, then delete the classes.
3. Still kept for later steps: `.fold*`, `.setting-row*` (used by `ExportHistory`), `.track*` cards, `.track-menu*`, the
   render weight and preset badges, `LabelSettings`.
