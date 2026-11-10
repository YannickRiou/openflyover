import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const D = dirname(fileURLToPath(import.meta.url))
const R = process.argv[2]
for (const f of ['computer', 'phone']) {
  const read = (p) => JSON.parse(gunzipSync(readFileSync(p).subarray(8)).toString())
  const a = read(`${D}/old-${f}.bin`)
  const b = read(`${R}/bench/${f}.opnflvr`)
  const diffs = []
  const walk = (x, y, path) => {
    if (typeof x !== 'object' || x === null || typeof y !== 'object' || y === null) {
      if (x !== y) diffs.push(`${path}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`)
      return
    }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${path}.${k}`)
  }
  walk(a, b, f)
  console.log(diffs.join('\n'))
}
