// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

let host: HTMLElement
let root: Root

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

beforeEach(() => {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.body.innerHTML = ''
})

const render = (ui: React.ReactElement) => act(async () => root.render(ui))
const button = () => host.querySelector<HTMLButtonElement>('button')!

describe('Button', () => {
  it('is a native button of type button, named and identified by what the screen gives it', async () => {
    await render(
      <Button aria-label="Enregistrer" data-testid="save" aria-expanded={false}>
        Ok
      </Button>,
    )
    expect(button().type).toBe('button')
    expect(button().getAttribute('aria-label')).toBe('Enregistrer')
    expect(button().dataset.testid).toBe('save')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(button().textContent).toBe('Ok')
  })

  it('keeps the classes the screens key on: btn, btn--small; icon-btn for the icon variant', async () => {
    await render(
      <>
        <Button variant="primary" size="sm" block className="topbar__export">
          A
        </Button>
        <Button variant="icon" className="icon-btn--on">
          B
        </Button>
      </>,
    )
    const [primary, icon] = [...host.querySelectorAll('button')]
    expect(primary.classList.contains('btn')).toBe(true)
    expect(primary.classList.contains('btn--small')).toBe(true)
    expect(primary.classList.contains('topbar__export')).toBe(true)
    expect(icon.classList.contains('icon-btn')).toBe(true)
    expect(icon.classList.contains('icon-btn--on')).toBe(true)
    expect(icon.classList.contains('btn')).toBe(false)
  })

  it('calls onClick on a click, not when disabled', async () => {
    const onClick = vi.fn()
    await render(<Button onClick={onClick}>Go</Button>)
    await act(async () => button().click())
    expect(onClick).toHaveBeenCalledTimes(1)

    await render(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    )
    expect(button().disabled).toBe(true)
    await act(async () => button().click())
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('submits its form when it is a submit button', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
    await render(
      <form onSubmit={onSubmit}>
        <Button type="submit">Calculer</Button>
      </form>,
    )
    await act(async () => button().click())
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('gives its element through ref', async () => {
    const ref = createRef<HTMLButtonElement>()
    await render(<Button ref={ref}>Ok</Button>)
    expect(ref.current).toBe(button())
  })
})
