import { useId } from 'react'
import type { ReactNode } from 'react'
import type { LanguageCode } from '../i18n'

/** Three equal bands, vertical or horizontal, on a 3 × 2 flag. */
const bands = (colors: readonly [string, string, string], vertical: boolean): ReactNode =>
  colors.map((fill, i) => (vertical ? <rect key={fill} x={i * 10} width="10" height="20" fill={fill} /> : <rect key={fill} y={i * 6.667} width="30" height="6.667" fill={fill} />))

/**
 * Flag of the country of a language, drawn in SVG (the flag emoji are not drawn by Windows, which shows their two
 * letters instead). Decorative: the name of the language is always next to it or in the label of its button.
 */
export function Flag({ code }: { code: LanguageCode }) {
  const clip = useId()
  const british = code === 'en'
  return (
    <svg
      className="h-4 w-6 flex-none rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.25)]"
      viewBox={british ? '0 0 60 30' : '0 0 30 20'}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {code === 'fr' && bands(['#0055A4', '#FFFFFF', '#EF4135'], true)}
      {code === 'it' && bands(['#009246', '#FFFFFF', '#CE2B37'], true)}
      {code === 'de' && bands(['#000000', '#DD0000', '#FFCE00'], false)}
      {code === 'es' && (
        <>
          <rect width="30" height="20" fill="#AA151B" />
          <rect y="5" width="30" height="10" fill="#F1BF00" />
        </>
      )}
      {british && (
        <>
          <clipPath id={clip}>
            <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
          </clipPath>
          <rect width="60" height="30" fill="#012169" />
          <path d="M0,0 L60,30 M60,0 L0,30" stroke="#FFFFFF" strokeWidth="6" />
          <path d="M0,0 L60,30 M60,0 L0,30" clipPath={`url(#${clip})`} stroke="#C8102E" strokeWidth="4" />
          <path d="M30,0 v30 M0,15 h60" stroke="#FFFFFF" strokeWidth="10" />
          <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
        </>
      )}
    </svg>
  )
}
