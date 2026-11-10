// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { Effect, type EffectPass } from 'postprocessing'
import { PerspectiveCamera } from 'three'
import { useEffectPass } from './useLensEffects'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const camera = new PerspectiveCamera()
const effects = [new Effect('A', 'void mainImage(const in vec4 i, const in vec2 uv, out vec4 o) { o = i; }')]
/** effects of a pass (a private field of postprocessing's EffectPass) */
const effectsOf = (pass: EffectPass | null) => (pass ? (Reflect.get(pass, 'effects') as Effect[]) : null)

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
})

function mount(list: readonly Effect[]): { current: EffectPass | null } {
  const seen: { current: EffectPass | null } = { current: null }
  function Probe() {
    seen.current = useEffectPass(camera, list)
    return null
  }
  root = createRoot(document.createElement('div'))
  // StrictMode mounts, unmounts and mounts the effects again, as in development
  act(() => root!.render(<StrictMode><Probe /></StrictMode>))
  return seen
}

describe('useEffectPass', () => {
  it('keeps its effects through the simulated unmount of StrictMode', () => {
    const seen = mount(effects)
    expect(effectsOf(seen.current)).toEqual(effects)
  })

  it('gives no pass without effects', () => {
    expect(mount([]).current).toBeNull()
  })
})
