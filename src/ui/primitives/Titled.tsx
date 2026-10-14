import type { ReactNode } from 'react'

/**
 * A native tooltip over a whole control (why it is disabled): HeroUI's fields take no `title`, so it sits on a box that
 * adds nothing to the layout around them.
 */
export function Titled({ title, children }: { title: string | undefined; children: ReactNode }) {
  if (!title) return <>{children}</>
  return (
    <span title={title} style={{ display: 'contents' }}>
      {children}
    </span>
  )
}
