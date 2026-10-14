import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { LANGUAGES, useLanguage, useT } from '../i18n'
import { setPreferences } from './preferences'
import { Button, Tip } from './primitives'

/**
 * Language of the interface, in the top bar after « ? »: a button with the flag and the code of the current language
 * opens the list of the languages (native names). Arrows move in the list, Escape closes it and gives the focus back.
 * The choice is a preference of the device (`preferences.ts`).
 */
export function LanguageMenu() {
  const t = useT()
  const language = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[0]

  useEffect(() => {
    if (!open) return
    // the checked item takes the focus, so the keyboard starts where the choice is
    ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return
    if (e.key === 'Escape') {
      setOpen(false)
      button.current?.focus()
      e.stopPropagation()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    const next = items[(index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]
    next?.focus()
    e.preventDefault()
  }

  return (
    <div ref={ref} className="lang-menu" data-local-escape="" onKeyDown={onKeyDown}>
      <Tip text={t('topbar.language.label')}>
        <Button
          variant="icon"
          className="lang-menu__button"
          ref={button}
          data-testid="language-button"
          aria-label={t('topbar.language.aria', { name: current.name })}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className="lang-menu__flag" aria-hidden="true">
            {current.flag}
          </span>
          {current.code.toUpperCase()}
        </Button>
      </Tip>
      {open && (
        <div className="track-menu topbar__menu lang-menu__list" role="menu" aria-label={t('topbar.language.menu')}>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={l.code === language}
              lang={l.code}
              className="track-menu__item lang-menu__item"
              onClick={() => {
                setPreferences({ language: l.code })
                setOpen(false)
                button.current?.focus()
              }}
            >
              <span aria-hidden="true">{l.flag}</span>
              {l.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
