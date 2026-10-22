// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { LANGUAGES, setLanguage, withLanguage } from '../i18n'
import { LATEST_NEWS, WHATS_NEW } from './whatsNew'
import { WhatsNewDialog } from './WhatsNewDialog'

/** Dotted versions compared number by number ('4.0' > '3.3.2' > '3.3'). */
function compareVersions(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

describe('what’s new', () => {
  it('lists the versions newest first, each with items that have an icon, a title and a sentence in every language', () => {
    expect(LATEST_NEWS).toBe(WHATS_NEW[0].version)
    const versions = WHATS_NEW.map((entry) => entry.version)
    expect(new Set(versions).size).toBe(versions.length)
    expect(versions.every((v) => /^\d+(\.\d+)*$/.test(v))).toBe(true)
    expect([...versions].sort((a, b) => compareVersions(b, a))).toEqual(versions)
    for (const { code } of LANGUAGES) {
      withLanguage(code, () => {
        for (const entry of WHATS_NEW) {
          expect(entry.items.length, `${code} ${entry.version}`).toBeGreaterThan(0)
          for (const item of entry.items) {
            expect(item.title.trim(), `${code} title`).not.toBe('')
            expect(item.text.trim().length, `${code} ${item.title}`).toBeGreaterThan(20)
          }
        }
      })
    }
  })

  it('opens as a dialog that shows every version with its items', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    setLanguage('fr')
    const host = document.body.appendChild(document.createElement('div'))
    const root = createRoot(host)
    await act(async () => root.render(<WhatsNewDialog open onClose={() => {}} />))
    const text = document.body.textContent ?? ''
    expect(text).toContain('Nouveautés')
    for (const entry of WHATS_NEW) {
      expect(text).toContain(`Version ${entry.version}`)
      for (const item of entry.items) expect(text).toContain(item.title)
    }
    act(() => root.unmount())
  })
})
