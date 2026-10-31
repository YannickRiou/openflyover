import { useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useT } from '../i18n'
import { searchSections } from './settingsSearch'
import type { SectionMatch } from './settingsSearch'
import type { ShellTab } from './shell'
import { Modal, TextField } from './primitives'

const OPTION =
  'flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-sm px-2 py-2 text-left text-body text-text-1 transition-ui hover:bg-surface-card aria-selected:bg-surface-card'

/**
 * « Rechercher un réglage » (Ctrl+K): a field and the sections of the panels whose title matches. ↑ ↓ choose, Enter (or a
 * click) closes the dialog and hands the section to `onPick`, Escape closes it.
 */
export function SettingsSearch({ open, tabs, onClose, onPick }: { open: boolean; tabs: readonly ShellTab[]; onClose(): void; onPick(match: SectionMatch): void }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // about thirty sections: worded and filtered at each render, so a change of language shows at once
  const results = searchSections(query, tabs)
  // the dialog opens empty, on its first result
  const reset = () => {
    setQuery('')
    setActive(0)
  }
  const close = () => {
    reset()
    onClose()
  }
  const pick = (match: SectionMatch | undefined) => {
    if (!match) return
    reset()
    onPick(match)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (results.length === 0 ? 0 : (i + step + results.length) % results.length))
    } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      pick(results[active])
    }
  }
  return (
    <Modal open={open} onClose={close} title={t('shell.search.title')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')} width={480}>
      <TextField
        type="search"
        autoFocus
        autoComplete="off"
        aria-label={t('shell.search.title')}
        aria-describedby="settings-search-results"
        placeholder={t('shell.search.placeholder')}
        value={query}
        onChange={(value) => {
          setQuery(value)
          setActive(0)
        }}
        onKeyDown={onKeyDown}
      />
      <ul id="settings-search-results" role="listbox" aria-label={t('shell.search.results')} className="mt-3 flex max-h-[50vh] flex-col overflow-y-auto" data-testid="settings-search-results">
        {results.map((match, i) => (
          <li key={`${match.tab}/${match.title}`} role="option" aria-selected={i === active}>
            <button type="button" tabIndex={-1} className={OPTION} aria-selected={i === active} onClick={() => pick(match)} onMouseMove={() => setActive(i)}>
              <span>{match.title}</span>
              <span className="type-hint">{match.tabLabel}</span>
            </button>
          </li>
        ))}
      </ul>
      {results.length === 0 && <p className="type-hint mt-3">{t('shell.search.empty')}</p>}
    </Modal>
  )
}
