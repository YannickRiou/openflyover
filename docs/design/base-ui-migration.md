# Design: interactive UI primitives on Base UI

Status: superseded by [heroui.md](heroui.md).

## Why

The interface hand-codes several interactive patterns (tooltips with their own collision code, three menus each
with its own outside-click / Escape / focus handling, a context menu, a toast queue, roving tab indices). They work,
but each copy is code to maintain and to get right for keyboard and screen-reader users. [Base UI](https://base-ui.com)
(`@base-ui/react`, MIT, React 17–19, maintained by MUI with part of the original Radix team; v1.0 December 2025)
provides these behaviours as **unstyled** parts: the « Carte alpine » look of `src/ui/theme.css` stays, the parts
expose `data-open`, `data-checked`, `data-highlighted`… attributes that the CSS keys off, as it already does with
`aria-*` today.

Native elements that already behave well are **kept**: the goal is less hand-written behaviour, not a new widget
for every control.

## Scope

| Pattern | Today | Decision | Base UI part |
|---|---|---|---|
| Tooltips | CSS `[data-tip]:hover::after` + `installTipPlacement` (shell.ts) for collisions, `InfoTip`, `RenderWeight`; 53 uses | **migrate** through one `<Tip>` wrapper | Tooltip |
| « ⋯ » / « + » menus | `MoreMenu` (TopBar), `AddTracksMenu` (TrackList): hand-made outside click, Escape, no arrow keys | **migrate** | Menu |
| Timeline options | `FilmOptions` (Timeline): a panel of buttons and checkboxes | **migrate** | Popover |
| 3D context menu | `TrackMenu` (scene/TrackPicker): right click / long press after a raycast, then a name form | **migrate the menu part** (picking and long press stay) | Menu with a virtual anchor, controlled `open` |
| Toasts | `Toaster` over the zustand `showToast` store | **migrate**, keep `showToast` as the API | Toast |
| Rail tabs | `role=tablist`, roving tab index (`nextTabIndex`), panels always mounted | **migrate** (`keepMounted`, vertical) | Tabs |
| Expandable setting rows | `SettingRow`: button + `aria-expanded` + `hidden` body | **migrate** | Collapsible |
| Anchor picker | 3×3 `role=radio` grid with `nextGridIndex` | **migrate** | RadioGroup |
| Switches, segmented choices, chips | native checkbox / radio styled by CSS | **migrate the wrappers only** (`.checkbox--switch`, `.segmented`, `.chip`) when the CSS needs `:has()` tricks | Switch, RadioGroup, ToggleGroup |
| Sliders (`RangeField`) | native `<input type=range>` + `<output>` | **keep native** (mobile-friendly, accessible as is) | — |
| Selects | 33 native `<select>` | **keep native** (native pickers on phones) | — |
| Colour | native `<input type=color>` + swatches | **keep native** | — |
| Dialogs | native `<dialog>.showModal()` (help, diagnostic, Strava, sources) | **keep native** (modality, Escape and backdrop for free) | — |
| Folding sections | `<details>` (`PanelSection`, history) | **keep native** | — |
| Number fields | 3 `type=number` | **keep native** | — |
| Export drawer | CSS-driven dock / bottom sheet | **keep** (not a modal) | — |

## Rules

- Each Base UI part is wrapped once in `src/ui/primitives/` (`Tip`, `MenuButton`, `PopoverButton`, `Toasts`,
  `RailTabs`, `Collapsible`, `ChoiceGroup`…) with the project's class names; screens use the wrappers, never
  `@base-ui/react` directly. A later change of library touches one folder.
- Styling stays in the existing CSS files, keyed on Base UI's `data-*` attributes; no inline styles, no new tokens.
- Escape order is preserved: an open menu / popover / tooltip closes before the app's own Escape handling
  (today `data-local-escape` and `handlesOwnEscape` in App.tsx).
- Portals render inside the app root so the theme variables (`:root[data-theme]`) and the density apply.
- Touch: tooltips open on long press as today; menus open on tap.
- Every change keeps the French labels identical (through the i18n keys) and updates the unit tests and the
  end-to-end selectors it breaks (rail tabs `#tab-*`, `.toast`, `.setting-row__head`, `dataset.tip`).

## Order (one pull request each)

1. Add `@base-ui/react`, the `primitives/` folder, **Tooltip** (`<Tip>`), delete `installTipPlacement` and the
   tooltip CSS it replaces.
2. **Menu / Popover**: `MoreMenu`, `AddTracksMenu`, `FilmOptions`; delete the three hand-made dismiss handlers.
3. **Toast** behind `showToast`.
4. **TrackMenu** on Menu with a virtual anchor.
5. **Rail tabs** on Tabs.
6. **SettingRow** on Collapsible; **AnchorPicker** on RadioGroup.
7. Switch / segmented / chip wrappers, only where it removes CSS tricks.

Each step: `npm run typecheck`, `npm run lint`, `npx vitest run --maxWorkers=1`, `npm run build` and the end-to-end
scenarios (`OPENFLYOVER_E2E_SKIP_EXPORT=1 npm run e2e`) pass; bundle size noted in the pull request.
