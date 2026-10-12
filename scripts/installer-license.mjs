#!/usr/bin/env node
/**
 * Generates the licence page shown by the desktop installers: src-tauri/installer/license.rtf (Windows installers,
 * macOS disk image; `bundle.licenseFile` in tauri.conf.json) and license.txt (the Debian package's copyright file).
 *
 * Content: the MIT licence of OpenFlyover (LICENSE), then a reminder, grouped by licence, of the components it
 * redistributes (read from THIRD_PARTY_NOTICES.md, so run `npm run notices` or this script after it), then the
 * attributions of the data services (the « Displayed attribution » column of docs/sources.md). No network access.
 *
 * Usage: npm run notices (regenerates THIRD_PARTY_NOTICES.md first), or node scripts/installer-license.mjs alone.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src-tauri/installer')
const read = (path) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n')

// ------------------------------------------------------------------------------------------------ inputs

/** Lines `- name version: licence` of a section of THIRD_PARTY_NOTICES.md. */
function components(notices, title) {
  const start = notices.indexOf(`\n## ${title}`)
  if (start < 0) throw new Error(`THIRD_PARTY_NOTICES.md: section « ${title} » introuvable`)
  const end = notices.indexOf('\n## ', start + 1)
  const section = notices.slice(start, end < 0 ? undefined : end)
  const rows = [...section.matchAll(/^- (\S+) (\S+): (.+)$/gm)].map((m) => ({
    name: m[1].split('node_modules/').pop(),
    licence: m[3].replace(/ \(no license file.*$/, '').trim(),
  }))
  if (rows.length === 0) throw new Error(`THIRD_PARTY_NOTICES.md: aucune ligne dans « ${title} »`)
  return rows
}

/** Bundled assets (fonts, icons, geoid grid): `### name` followed by `License: …`. */
function assets(notices) {
  const start = notices.indexOf('\n## Bundled assets')
  const section = notices.slice(start, notices.indexOf('\n## npm packages'))
  return [...section.matchAll(/^### (.+)\n\nLicense: ([^.]+(?:\([^)]*\))?)\./gm)].map((m) => ({
    name: m[1].replace(/ \(.*$/, ''),
    licence: m[2].trim(),
  }))
}

/** Rows of the table « Attributions, licenses and offline use » of docs/sources.md: source and quoted attributions. */
function attributions(sources) {
  const start = sources.indexOf('| Source |')
  const rows = []
  for (const line of sources.slice(start).split('\n').slice(2)) {
    if (!line.startsWith('|')) break
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'))
    const quotes = [...cells[3].matchAll(/"([^"]+)"/g)].map((q) => q[1])
    if (quotes.length) rows.push({ source: cells[0], quotes })
  }
  if (rows.length < 5) throw new Error('docs/sources.md: tableau des attributions introuvable')
  return rows
}

// ------------------------------------------------------------------------------------------------ grouping

const MAIN_GROUPS = [
  ['MIT', 'MIT (seule, ou au choix avec une autre licence permissive)'],
  ['Apache-2.0', 'Apache-2.0'],
  ['ISC', 'ISC'],
  ['BSD', 'BSD (2 ou 3 clauses)'],
  ['OFL-1.1', 'SIL Open Font License 1.1 (OFL-1.1, polices)'],
  ['MPL-2.0', 'MPL-2.0'],
]

const NOTES = {
  'MPL-2.0': 'Licence à copyleft limité aux fichiers : le code source d’un fichier modifié doit être publié.',
}

/** Group of an SPDX expression: the first of MAIN_GROUPS offered, or the expression itself (AND, other licences). */
function groupOf(expression) {
  const expr = expression.replace(/[()]/g, '').replace(/\//g, ' OR ').replace(/\s+/g, ' ').trim()
  if (expr.includes(' AND ')) return `Autres : ${expression.trim()}`
  const ids = expr.replace(/ WITH \S+/g, '').split(' OR ')
  for (const [key] of MAIN_GROUPS) {
    if (ids.some((id) => (key === 'BSD' ? /^BSD-[23]-Clause$/.test(id) : id === key))) return key
  }
  return `Autres : ${expr}`
}

const ASSET_LABELS = [
  [/^Fraunces/, 'police Fraunces'],
  [/^IBM Plex/, 'polices IBM Plex Sans et IBM Plex Sans Condensed'],
  [/^Lucide/, 'icônes Lucide (portions MIT, de Feather)'],
  [/^EGM96/, 'grille de géoïde EGM96 (NGA, domaine public)'],
]

function buildBlocks() {
  const notices = read('THIRD_PARTY_NOTICES.md')
  const npm = components(notices, 'npm packages')
  const rust = components(notices, 'Rust crates')
  const groups = new Map()
  const add = (kind, row) => {
    const key = groupOf(row.licence)
    const group = groups.get(key) ?? { npm: new Set(), rust: new Set(), assets: [] }
    group[kind].add(row.name)
    groups.set(key, group)
  }
  npm.forEach((row) => add('npm', row))
  rust.forEach((row) => add('rust', row))
  for (const asset of assets(notices)) {
    const label = ASSET_LABELS.find(([re]) => re.test(asset.name))?.[1]
    if (!label) continue // MIT assets (sky data, sample track) are covered by their packages
    const key = asset.licence.startsWith('OFL') ? 'OFL-1.1' : asset.licence.startsWith('ISC') ? 'ISC' : 'Autres : domaine public'
    const group = groups.get(key) ?? { npm: new Set(), rust: new Set(), assets: [] }
    group.assets.push(label)
    groups.set(key, group)
  }

  /** Text of the MIT licence: paragraphs on one line each, so that the page reflows. */
  const mit = read('LICENSE').trim().split(/\n{2,}/).map((p) => p.replace(/\n/g, ' '))
  const blocks = [{ kind: 'title', text: 'Licence d’OpenFlyover' }, ...mit.map((text) => ({ kind: 'p', text }))]

  blocks.push(
    { kind: 'title', text: 'Licences des composants utilisés' },
    {
      kind: 'p',
      text:
        `OpenFlyover redistribue ${npm.length} paquets npm et ${rust.length} bibliothèques Rust, ainsi que des polices et des ` +
        'icônes, chacun sous sa propre licence. Les composants sont regroupés ci-dessous par licence ; une double licence est ' +
        'classée dans le premier des groupes ci-dessous qu’elle propose.',
    },
  )
  const names = (set) => [...set].sort((a, b) => a.localeCompare(b, 'en'))
  const order = [...MAIN_GROUPS.map(([key]) => key), ...[...groups.keys()].filter((k) => k.startsWith('Autres')).sort()]
  for (const key of order) {
    const group = groups.get(key)
    if (!group) continue
    const label = MAIN_GROUPS.find(([k]) => k === key)?.[1] ?? key
    const count = group.npm.size + group.rust.size + group.assets.length
    blocks.push({ kind: 'heading', text: `${label} : ${count} composant${count > 1 ? 's' : ''}` })
    if (NOTES[key]) blocks.push({ kind: 'p', text: NOTES[key] })
    if (group.assets.length) blocks.push({ kind: 'p', text: `Ressources : ${group.assets.join(', ')}.` })
    if (group.npm.size) blocks.push({ kind: 'p', text: `npm : ${names(group.npm).join(', ')}.` })
    if (group.rust.size) blocks.push({ kind: 'p', text: `Rust : ${names(group.rust).join(', ')}.` })
  }

  const services = attributions(read('docs/sources.md'))
  blocks.push(
    { kind: 'title', text: 'Données et services en ligne' },
    {
      kind: 'p',
      text:
        'Les fonds de carte, le relief, la météo et les repères sont téléchargés pendant l’utilisation, auprès de services ' +
        'ouverts ; ils ne sont pas inclus dans l’application. Mentions affichées : ' +
        services.map((s) => `${s.source} : ${s.quotes.map((q) => `«\u00a0${q}\u00a0»`).join(', ')}`).join(' ; ') +
        '.',
    },
    {
      kind: 'p',
      text:
        'Les textes complets des licences sont dans le fichier THIRD_PARTY_NOTICES.md, installé à côté de l’application.',
    },
  )
  return blocks
}

// ------------------------------------------------------------------------------------------------ output

/** RTF text: backslash and braces escaped, Latin-1 as \'xx, other characters as \uN? (signed 16 bits), all ASCII. */
function rtfEscape(text) {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    if (char === '\\' || char === '{' || char === '}') out += `\\${char}`
    else if (code < 0x80) out += char
    else if (code <= 0xff) out += `\\'${code.toString(16).padStart(2, '0')}`
    else if (code <= 0xffff) out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`
    else throw new Error(`character outside the BMP: ${char}`)
  }
  return out
}

function toRtf(blocks) {
  const body = blocks.map(({ kind, text }) => {
    const t = rtfEscape(text)
    if (kind === 'title') return `\\pard\\sb240\\sa120\\keepn{\\b\\fs26 ${t}}\\par`
    if (kind === 'heading') return `\\pard\\sb160\\sa60\\keepn{\\b\\fs21 ${t}}\\par`
    return `\\pard\\sa120\\sl264\\slmult1 ${t}\\par`
  })
  return `{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1036{\\fonttbl{\\f0\\fswiss\\fcharset0 Arial;}}\\viewkind4\\uc1\\f0\\fs20\n${body.join('\n')}\n}\n`
}

function wrap(text, width = 88) {
  const lines = []
  let line = ''
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  return [...lines, line].join('\n')
}

function toText(blocks) {
  return (
    blocks
      .map(({ kind, text }) => (kind === 'title' ? `\n${text.toUpperCase()}\n${'='.repeat(text.length)}` : kind === 'heading' ? `\n${text}` : wrap(text)))
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

const blocks = buildBlocks()
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'license.rtf'), toRtf(blocks))
writeFileSync(join(OUT, 'license.txt'), toText(blocks))
console.log(`src-tauri/installer/license.rtf, license.txt (${blocks.length} blocs)`)
