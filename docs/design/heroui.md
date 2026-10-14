# Design: interactive components on HeroUI

Status: accepted. Target: v2.0.0 (after v1.0.0). Requires [tailwind.md](tailwind.md) step 1.
Replaces [base-ui-migration.md](base-ui-migration.md).

## Why

[HeroUI](https://heroui.com) v3 (`@heroui/react` + `@heroui/styles`, MIT, 3.2.6 at the time of writing) is a
React 19 component library built on React Aria Components (Adobe, Apache-2.0) for keyboard, focus and
screen-reader behaviour, styled with Tailwind CSS v4. Compared with Base UI, it brings a finished, consistent
visual language (states, focus rings, motion) on top of the behaviour, which is the « more professional look »
asked for, while its theme is CSS variables that we set from our own palette.

## Constraints

- **Free and customisable only.** Only the MIT packages `@heroui/react` and `@heroui/styles` (and their open
  source dependencies) are used. No HeroUI Pro component, paid template or hosted service; nothing that cannot
  be restyled from the repository. A component that only exists in a paid tier is built from the free parts or
  kept native.
- **Same identity.** HeroUI's theme variables are set from the `theme.css` tokens (palette, fonts, radii) for the
  light and dark themes; no HeroUI default colour stays visible. Contrast ≥ 4.5:1.
- **Same features and labels.** Every control keeps its behaviour, shortcuts and French text (i18n keys).
- **Both targets.** Bundled at build time, no network at runtime; works in the static site and in Tauri.

## Scope

| Pattern | Today | HeroUI component |
|---|---|---|
| Tooltips (53 uses, `installTipPlacement`) | CSS `[data-tip]` + collision code | Tooltip |
| « ⋯ » / « + » menus, 3D context menu | hand-made dismiss / Escape / focus | Dropdown / Menu (virtual anchor for the 3D one) |
| Timeline options | panel of buttons | Popover |
| Toasts | `Toaster` over `showToast` | Toast, `showToast` kept as the API |
| Rail tabs | `role=tablist` + roving index | Tabs (vertical, panels kept mounted) |
| Setting rows, folding sections | `SettingRow`, `<details>` | Disclosure / Accordion |
| Switches, checkboxes, segmented choices, chips | styled native inputs | Switch, Checkbox, RadioGroup, ToggleButtonGroup, Chip |
| Buttons | `.btn` variants | Button, ButtonGroup |
| Sliders (`RangeField`) | native range + output | Slider (touch and keyboard checked on phone) |
| Selects (33) | native `<select>` | Select, **only where it stays usable on phones**; otherwise native |
| Number and text fields | native inputs | NumberField, TextField |
| Colour | native colour input + swatches | ColorSwatchPicker + ColorArea / ColorSlider / ColorField in a Popover (`ColorField` primitive, step 6c; the panel is a bottom sheet on a phone, no native input kept: touch-checked) |
| Dialogs (help, diagnostic, Strava, sources) | native `<dialog>` | Modal (`Modal` primitive, step 6c) |
| Export drawer | CSS dock / bottom sheet | Drawer, if it keeps the non-modal dock; otherwise kept |
| Scene, timeline canvas, 3D picking | custom | **kept** (not form controls) |

## Rules

- Each HeroUI component is wrapped once in `src/ui/primitives/` with the project's props; screens never import
  `@heroui/react` directly, so a later change of library touches one folder.
- Escape order is preserved (`data-local-escape`, `handlesOwnEscape` in App.tsx): an open overlay closes first.
- Portals render inside the app root so theme and density apply.
- Unit tests and end-to-end selectors use roles and labels, not HeroUI's generated class names.

## Order (one pull request each, after Tailwind step 1)

1. Add the packages, theme mapping (light/dark), `primitives/`, **Button** and **Tooltip**.
2. **Menu / Dropdown / Popover**, then the 3D context menu.
3. **Toast** behind `showToast`.
4. **Tabs** (rail), **Disclosure** (setting rows, sections).
5. Form controls: Switch, Checkbox, RadioGroup, ToggleButtonGroup, Slider, NumberField, TextField.
6. Select and colour, phone-tested; **Modal** for the dialogs.
7. Export drawer, then removal of the CSS and hand-written behaviour left unused.

Each step: `npm run typecheck`, `npm run lint`, `npx vitest run --maxWorkers=1`, `npm run build` and the
end-to-end scenarios (`OPENFLYOVER_E2E_SKIP_EXPORT=1 npm run e2e`) pass; before/after screenshots (light, dark,
phone width) and bundle size in the pull request.

## Risks

- Bundle size: React Aria is larger than Base UI; measured per step, tree-shaken per component entry point.
- Native mobile pickers (select, colour) are lost where replaced: hence the phone check before each swap.
- Library churn: HeroUI v3 is recent (stable since March 2026); the `primitives/` wrappers limit the blast radius.
