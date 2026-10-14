// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { isModalOpen } from './overlay'
import { Modal } from './Modal'
import { Popover } from './Popover'

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

/** The focus goes back a frame after the modal is gone. */
const nextFrame = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 50))))
const key = (el: Element, k: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"][data-modal]')
const opener = () => host.querySelector<HTMLButtonElement>('button')!

/** A button that opens a modal holding `children`, the way a screen does. */
function Screen({ onClose, children }: { onClose?(): void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Ouvrir</Button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          onClose?.()
        }}
        title="Raccourcis clavier"
        closeLabel="Fermer"
        closeTip="Fermer (Échap)"
        width={680}
      >
        {children ?? <p>Contenu</p>}
      </Modal>
    </>
  )
}

const open = async (ui: React.ReactElement = <Screen />) => {
  await act(async () => root.render(ui))
  opener().focus()
  await act(async () => opener().click())
  await nextFrame()
}

describe('Modal', () => {
  it('is absent while closed, then a dialog named by its heading, out of its container, with the focus inside', async () => {
    await act(async () => root.render(<Screen />))
    expect(dialog()).toBeNull()
    expect(isModalOpen()).toBe(false)
    await open()
    expect(isModalOpen()).toBe(true)
    const el = dialog()!
    expect(el.getAttribute('aria-labelledby')).toBe(el.querySelector('h2')!.id)
    expect(el.querySelector('h2')!.textContent).toBe('Raccourcis clavier')
    expect(el.textContent).toContain('Contenu')
    expect(host.contains(el)).toBe(false)
    expect(el.style.getPropertyValue('--modal-w')).toBe('680px')
    expect(el.contains(document.activeElement)).toBe(true)
  })

  it('closes with its button and gives the focus back to what opened it', async () => {
    const onClose = vi.fn()
    await open(<Screen onClose={onClose} />)
    await act(async () => dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Fermer"]')!.click())
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    await nextFrame()
    expect(document.activeElement).toBe(opener())
  })

  it('closes on Escape, giving the focus back', async () => {
    const onClose = vi.fn()
    await open(<Screen onClose={onClose} />)
    await key(document.activeElement!, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(dialog()).toBeNull()
    await nextFrame()
    expect(document.activeElement).toBe(opener())
  })

  it('closes on a click on the backdrop, not on a click inside', async () => {
    const onClose = vi.fn()
    await open(<Screen onClose={onClose} />)
    const press = (el: Element) =>
      act(async () => {
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }))
        }
      })
    await press(dialog()!.querySelector('p')!)
    expect(onClose).not.toHaveBeenCalled()
    await press(document.querySelector('.modal__backdrop')!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('holds the popovers opened from inside it, which keep Escape until they are closed', async () => {
    const onClose = vi.fn()
    await open(
      <Screen onClose={onClose}>
        <Popover label="Options" trigger={<Button>Plus</Button>}>
          <input aria-label="Nom" />
        </Popover>
      </Screen>,
    )
    await act(async () => [...dialog()!.querySelectorAll('button')].find((b) => b.textContent === 'Plus')!.click())
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Options"]')!
    // portalled into the modal (`openDialog()`), else the modal's inert page would hide it
    expect(dialog()!.contains(panel)).toBe(true)
    await key(panel.querySelector('input') ?? panel, 'Escape')
    expect(document.querySelector('[role="dialog"][aria-label="Options"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    await key(dialog()!, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
