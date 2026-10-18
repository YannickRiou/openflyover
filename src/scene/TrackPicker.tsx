/**
 * TrackPicker — direct manipulation of the first track in the 3D view: a click on the line moves the playhead there, a
 * right-click opens a small menu (`TrackMenu`, DOM, next to the canvas) to add a stop, a text, a speed portion or a
 * point of interest; on a touch screen a tap is the click and a long press (`LONG_PRESS_MS`, one finger held still) the
 * right-click. A press that travels `CLICK_SLOP_PX` or more is a camera drag (OrbitControls), not a click.
 * Nothing during an export.
 *
 * Picking is in screen space (`pickProjectedPath`, pure): the path draped like the line, projected with the camera,
 * nearest within `PICK_RADIUS_PX`; a part hidden by the relief can be picked too. The relief is picked by a ray on the
 * tiles drawn, only on a right-click.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { Raycaster, Vector2, Vector3 } from 'three'
import { create } from 'zustand'
import type { LonLat } from '../core/types'
import { isExportBusy, useExportStore } from '../export/store'
import { filmClockFor } from '../film/clock'
import { POI_NAME_MAX, addPoi, defaultPoiName } from '../film/pois'
import { addSpeed, addStop, addText } from '../film/timeline'
import { flightOffsetAt, trackHeightM } from '../flyover/flights'
import { buildTrackPath, pickProjectedPath, samplePath } from '../flyover/path'
import { useT } from '../i18n'
import { useAppStore } from '../state/store'
import { Menu, Popover, TextField } from '../ui/primitives'
import type { MenuItem } from '../ui/primitives'
import { useTerrainContext } from './terrainContext'
import { LINE_LIFT_M } from './trackLineSet'
import { editFilm, getFilmSource, useFilmClock, useFilmTrack } from './usePacing'

/** Pointer distance to the line that still picks it (CSS pixels). */
const PICK_RADIUS_PX = 12
/** Travel between press and release beyond which the press was a camera drag. */
const CLICK_SLOP_PX = 4
/** A finger held this long without moving (beyond `LONG_PRESS_SLOP_PX`) opens the menu. */
const LONG_PRESS_MS = 500
const LONG_PRESS_SLOP_PX = 10
/** Samples of the path projected on screen (evenly spaced along it; between two of them the pick interpolates). */
const PICK_SAMPLES = 1500
/** Draped positions are recomputed after this delay (the terrain keeps loading finer tiles). */
const DRAPE_TTL_MS = 1000

interface TrackMenuState {
  /**
   * position in the canvas (CSS pixels), distance along the first track (off the line: none), place on the ground,
   * and whether it now asks for the name of a point of interest
   */
  menu: { x: number; y: number; atM?: number; ground?: LonLat; naming?: boolean } | null
}

/** a pointer position (event or remembered press) */
type At = Pick<PointerEvent, 'clientX' | 'clientY'>

const useTrackMenu = create<TrackMenuState>(() => ({ menu: null }))
const closeMenu = () => useTrackMenu.setState({ menu: null })
const exporting = () => isExportBusy(useExportStore.getState().phase)

/** Picks the first track under the pointer; mounted inside the terrain layer of the canvas. */
export function TrackPicker() {
  const camera = useThree((s) => s.camera)
  const canvas = useThree((s) => s.gl.domElement)
  const { engine, frame } = useTerrainContext()
  const track = useFilmTrack()
  const exaggeration = useAppStore((s) => s.settings.exaggeration)
  const clock = useFilmClock()
  const clockRef = useRef(clock)
  useEffect(() => {
    clockRef.current = clock
  }, [clock])

  const samples = useMemo(() => {
    const path = track ? buildTrackPath(track) : null
    if (!path || path.count < 2 || path.lengthM <= 0) return null
    const n = PICK_SAMPLES
    const distM = new Float64Array(n)
    const lon = new Float64Array(n)
    const lat = new Float64Array(n)
    const ele = new Float64Array(n)
    for (let k = 0; k < n; k++) {
      distM[k] = (k / (n - 1)) * path.lengthM
      const p = samplePath(path, distM[k])
      lon[k] = p.lon
      lat[k] = p.lat
      ele[k] = p.ele ?? Number.NaN
    }
    return { distM, lon, lat, ele, lengthM: path.lengthM, path }
  }, [track])
  /** draped local positions (xyz per sample) and when they were computed */
  const drapeRef = useRef<{ at: number; world: Float32Array } | null>(null)

  useEffect(() => {
    drapeRef.current = null
    if (!samples || !frame) return
    const v = new Vector3()
    const screen = new Float32Array(samples.distM.length * 2)

    const drape = () => {
      const now = performance.now()
      const cached = drapeRef.current
      if (cached && now - cached.at < DRAPE_TTL_MS) return cached.world
      const world = cached?.world ?? new Float32Array(samples.distM.length * 3)
      for (let k = 0; k < samples.distM.length; k++) {
        const flight = flightOffsetAt(samples.path.flights, samples.distM[k])
        const h = trackHeightM(engine?.sampleHeight(samples.lon[k], samples.lat[k]), samples.ele[k], flight)
        frame.toLocal(samples.lon[k], samples.lat[k], h * exaggeration + LINE_LIFT_M, v)
        world[3 * k] = v.x
        world[3 * k + 1] = v.y
        world[3 * k + 2] = v.z
      }
      drapeRef.current = { at: now, world }
      return world
    }

    /** distance along the track under the pointer, undefined when the line is not there */
    const pick = (e: At): number | undefined => {
      const rect = canvas.getBoundingClientRect()
      const world = drape()
      for (let k = 0; k < samples.distM.length; k++) {
        v.set(world[3 * k], world[3 * k + 1], world[3 * k + 2]).project(camera)
        const behind = v.z < -1 || v.z > 1
        screen[2 * k] = behind ? Number.NaN : ((v.x + 1) / 2) * rect.width
        screen[2 * k + 1] = behind ? Number.NaN : ((1 - v.y) / 2) * rect.height
      }
      return pickProjectedPath(screen, samples.distM, e.clientX - rect.left, e.clientY - rect.top, PICK_RADIUS_PX)
    }

    const raycaster = new Raycaster()
    const pointer = new Vector2()
    /** lon/lat of the relief under the pointer (first tile drawn along the ray), undefined where none is drawn */
    const pickGround = (e: At): LonLat | undefined => {
      if (!engine) return undefined
      const rect = canvas.getBoundingClientRect()
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(engine.group.children.filter((tile) => tile.visible), false)[0]
      if (!hit) return undefined
      const { lon, lat } = frame.toLonLat(hit.point)
      return { lon, lat }
    }

    const openMenu = (e: At, atM = pick(e)) => {
      const ground = pickGround(e) ?? (atM === undefined ? undefined : samplePath(samples.path, atM))
      if (atM === undefined && !ground) return
      const rect = canvas.getBoundingClientRect()
      useTrackMenu.setState({ menu: { x: e.clientX - rect.left, y: e.clientY - rect.top, atM, ground } })
    }

    let press: { x: number; y: number; button: number } | null = null
    /** fingers on the view, and the long press of the first one */
    let fingers = 0
    let longPress = 0
    const cancelLongPress = () => {
      window.clearTimeout(longPress)
      longPress = 0
    }
    const onPointerDown = (e: PointerEvent) => {
      press = { x: e.clientX, y: e.clientY, button: e.button }
      if (e.pointerType !== 'touch') return
      fingers++
      cancelLongPress()
      // a second finger: a pinch, neither a tap nor a long press
      if (fingers > 1) {
        press = null
        return
      }
      const at = { clientX: e.clientX, clientY: e.clientY }
      longPress = window.setTimeout(() => {
        longPress = 0
        press = null
        if (!exporting()) openMenu(at)
      }, LONG_PRESS_MS)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        fingers = Math.max(0, fingers - 1)
        cancelLongPress()
      }
      const p = press
      press = null
      if (!p || e.type === 'pointercancel' || p.button !== e.button || exporting() || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= CLICK_SLOP_PX) return
      const atM = pick(e)
      if (e.button === 0 && atM !== undefined) {
        const clock = clockRef.current
        const progress = atM / samples.lengthM
        const t = clock.timeAtProgress(progress)
        useAppStore.getState().setProgress(progress, t < clock.totalTime() ? t : null)
      } else if (e.button === 2) {
        openMenu(e, atM)
      }
    }
    const onPointerMove = (e: PointerEvent) => {
      if (longPress && press && Math.hypot(e.clientX - press.x, e.clientY - press.y) >= LONG_PRESS_SLOP_PX) cancelLongPress()
      if (e.buttons !== 0) return
      canvas.style.cursor = !exporting() && pick(e) !== undefined ? 'pointer' : ''
    }
    const onPointerLeave = () => {
      canvas.style.cursor = ''
    }
    // the menu replaces the browser's (the camera pans with a right drag)
    const onContextMenu = (e: MouseEvent) => e.preventDefault()

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerleave', onPointerLeave)
    canvas.addEventListener('contextmenu', onContextMenu)
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      cancelLongPress()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('contextmenu', onContextMenu)
      canvas.style.cursor = ''
    }
  }, [samples, frame, engine, exaggeration, camera, canvas])

  useEffect(() => closeMenu, [track])
  return null
}

/**
 * Menu of a right-click on the track (DOM, positioned in the canvas wrapper): add a stop, a text or a speed portion
 * there (×2 from that point; inside a portion, that portion is selected), one undo step each, the new block selected;
 * on the relief, on the track or off it, a point of interest (`PoiNameForm`). Anchored at the pointer (`Menu`, `Popover`
 * of the primitives), it closes like any overlay (Escape, a click elsewhere, a pick), on a resize and on export.
 */
type Item = 'stop' | 'text' | 'speed' | 'poi'

/** The « Ajouter » button of the form, a row of the popover: 32 px high, 44 px on a touch screen. */
const ADD =
  'h-8 cursor-pointer rounded-sm border-0 bg-transparent px-3 text-left font-body text-[13px]/none font-semibold whitespace-nowrap text-inherit touch:h-auto touch:min-h-11 hover:bg-white/10 focus-visible:bg-white/10'

/** The name of a point of interest added from the menu at `at`: Enter adds it (one undo step), empty = default name. */
function PoiNameForm({ at }: { at: LonLat }) {
  const t = useT()
  const placeholder = useAppStore((s) => defaultPoiName(s.settings.film))
  const [name, setName] = useState('')
  return (
    <form
      className="flex min-w-[200px] flex-col gap-1 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        closeMenu()
        editFilm((film) => ({ film: addPoi(film, at, name) }))
      }}
    >
      <TextField
        className="px-2 pt-1"
        labelClassName="text-[12px]/[1.2] font-semibold text-white"
        name="name"
        label={t('scene.menu.poiName')}
        autoFocus
        placeholder={placeholder}
        maxLength={POI_NAME_MAX}
        autoComplete="off"
        value={name}
        onChange={setName}
      />
      <button type="submit" className={ADD}>
        {t('scene.menu.add')}
      </button>
    </form>
  )
}

export function TrackMenu() {
  const t = useT()
  const menu = useTrackMenu((s) => s.menu)
  const busy = useExportStore((s) => isExportBusy(s.phase))

  useEffect(() => {
    if (!menu) return
    window.addEventListener('resize', closeMenu)
    return () => window.removeEventListener('resize', closeMenu)
  }, [menu])
  useEffect(() => {
    if (busy) closeMenu()
  }, [busy])

  if (!menu || busy) return null
  const add = (what: Item) => {
    if (what === 'poi') {
      useTrackMenu.setState({ menu: { ...menu, naming: true } })
      return
    }
    const source = getFilmSource()
    const lengthM = source.track?.stats.distanceM ?? 0
    if (lengthM <= 0 || menu.atM === undefined) return
    const atM = Math.round(menu.atM)
    const progress = menu.atM / lengthM
    if (what === 'stop') editFilm((f) => addStop(f, atM), { stops: true })
    else if (what === 'text') editFilm((f) => addText(f, filmClockFor(source).timeAtProgress(progress)))
    else editFilm((f) => addSpeed(f, atM, lengthM) ?? { film: f, id: f.speeds.find((s) => atM >= s.fromM && atM < s.toM)?.id })
  }
  const items: MenuItem[] = []
  if (menu.atM !== undefined) {
    items.push(
      { id: 'stop', label: t('scene.menu.addHold'), onSelect: () => add('stop') },
      { id: 'text', label: t('scene.menu.addText'), onSelect: () => add('text') },
      { id: 'speed', label: t('scene.menu.speed'), onSelect: () => add('speed') },
    )
  }
  if (menu.ground) items.push({ id: 'poi', label: t('scene.menu.poiHere'), onSelect: () => add('poi') })

  const point = { x: menu.x, y: menu.y }
  return menu.naming && menu.ground ? (
    <Popover label={t('scene.menu.poi')} point={point} onClose={closeMenu} placement="bottom start" sheet>
      <PoiNameForm at={menu.ground} />
    </Popover>
  ) : (
    // (picking a point of interest turns the menu into the name form: it is not closed then)
    <Menu label={t('scene.menu.addHere')} items={items} point={point} onClose={() => !useTrackMenu.getState().menu?.naming && closeMenu()} placement="bottom start" sheet />
  )
}
