/*
 * Primitives: one file per HeroUI component, wrapped with the project's own props and exported here; screens never import `@heroui/react`.
 * Styles: HeroUI's `components/<name>.css`, then the app's skin `primitives/<name>.css` (tokens only), both imported in `src/ui/theme.css`.
 * Overlays keep the app's Escape order (`data-local-escape`, `handlesOwnEscape` in App.tsx) and open inside a `<dialog>` that holds them.
 */
export { Button } from './Button'
export type { ButtonProps, ButtonVariant } from './Button'
export { Tip } from './Tip'
export type { TipProps, TipSide } from './Tip'
