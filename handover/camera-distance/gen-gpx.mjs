// Stand-in multi-day glacier tour around Arolla (not following real paths). Usage: node gen-gpx.mjs out.gpx
import { writeFileSync } from 'node:fs'
const days = [
  [['Arolla', 46.0245, 7.483], [46.02, 7.47], [46.015, 7.46], [46.01, 7.45], ['Pas de Chèvres', 46.006, 7.438], [46.008, 7.425], [46.004, 7.413], ['Cabane des Dix', 45.999, 7.399]],
  [[46.006, 7.402], [46.014, 7.41], ['La Luette', 46.023, 7.417], [46.03, 7.43], [46.022, 7.438], [46.012, 7.43], [46.003, 7.411], ['Cabane des Dix', 45.999, 7.399]],
  [[45.99, 7.41], [45.98, 7.422], ['Col de la Serpentine', 45.97, 7.435], [45.964, 7.452], [45.958, 7.47], [45.962, 7.485], ['Cabane des Vignettes', 45.969, 7.499]],
  [[45.96, 7.488], [45.952, 7.476], ["Pigne d'Arolla", 45.944, 7.465], [45.94, 7.48], [45.946, 7.495], [45.956, 7.505], ["Col de l'Évêque", 45.968, 7.513]],
  [[45.978, 7.52], [45.986, 7.528], ['Plans de Bertol', 45.996, 7.526], [45.99, 7.51], [45.978, 7.503], [45.97, 7.511], [45.966, 7.527], [45.974, 7.538], [45.988, 7.54]],
  [[46.0, 7.545], [46.015, 7.54], [46.03, 7.53], [46.04, 7.518], [46.045, 7.5], [46.04, 7.488], [46.033, 7.485], ['Arolla', 46.0245, 7.483]],
]
const R = 6371000
const rad = Math.PI / 180
const dist = (a, b) => Math.hypot((b[1] - a[1]) * rad * R * Math.cos(a[0] * rad), (b[0] - a[0]) * rad * R)
const t0 = Date.parse('2026-07-06T06:30:00Z')
const pts = []
days.forEach((wps, di) => {
  const w = wps.map((p) => (p.length === 3 ? [p[1], p[2]] : [p[0], p[1]]))
  const last = pts[pts.length - 1]
  const line = last ? [[last.lat, last.lon], ...w] : w
  let dayDist = 0
  const dayPts = []
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const L = dist(a, b)
    const n = Math.max(1, Math.round(L / 50))
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const f = k / n
      const wob = 25 * Math.sin((dayDist + f * L) / 380 + di) * Math.sin(Math.PI * f)
      const dxm = (b[1] - a[1]) * Math.cos(a[0] * rad)
      const dym = b[0] - a[0]
      const nl = Math.hypot(dxm, dym) || 1
      // perpendicular: (-dy, dx) in (east, north) metres
      const lat = a[0] + dym * f + (wob * (dxm / nl)) / (R * rad)
      const lon = a[1] + (b[1] - a[1]) * f + (wob * (-dym / nl)) / (R * rad * Math.cos(a[0] * rad))
      dayPts.push({ lat, lon })
    }
    dayDist += L
  }
  let run = 0
  dayPts.forEach((p, i) => {
    if (i > 0) run += dist([dayPts[i - 1].lat, dayPts[i - 1].lon], [p.lat, p.lon])
    p.time = t0 + di * 86400000 + (run / dayDist) * 7 * 3600000
    pts.push({ ...p, day: di })
  })
})
let len = 0
for (let i = 1; i < pts.length; i++) len += dist([pts[i - 1].lat, pts[i - 1].lon], [pts[i].lat, pts[i].lon])
const segs = days
  .map((_, d) => `<trkseg>\n${pts.filter((p) => p.day === d).map((p) => `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.time).toISOString()}</time></trkpt>`).join('\n')}\n</trkseg>`)
  .join('\n')
writeFileSync(
  process.argv[2],
  `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="stand-in" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>Arolla stand-in</name></metadata>\n<trk><name>Arolla glacier tour (stand-in)</name>\n${segs}\n</trk></gpx>\n`,
)
console.log('points', pts.length, 'length km', (len / 1000).toFixed(1))
