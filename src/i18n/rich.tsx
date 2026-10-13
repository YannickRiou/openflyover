import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { template } from './index'
import type { MessageKey } from './index'

/**
 * A message whose placeholders are React nodes (a link, a `<b>`): « Sur {link}, créez… ». The pieces of text between the
 * placeholders stay in the message, so a language may put the nodes anywhere in the sentence. `count` selects a plural form.
 */
export function tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode {
  const count = nodes.count
  const text = template(key, typeof count === 'number' ? { count } : undefined)
  return text.split(/\{(\w+)\}/).map((part, i) => <Fragment key={i}>{i % 2 === 0 ? part : (nodes[part] ?? `{${part}}`)}</Fragment>)
}
