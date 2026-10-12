import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { videoSize } from '../export/schedule'
import { CARD_LABELS, END_CARD_ID, TITLE_CARD_ID } from '../film/cards'
import type { CardId } from '../film/cards'
import { filmTrackOf } from '../flyover/sequence'
import { hasMetric } from '../flyover/trackColor'
import { fileToLogoDataUrl } from '../overlay/assets'
import {
  COUNTER_IDS,
  CREDITS_POSITIONS,
  OFFSET_MAX_PX,
  OVERLAY_FONT_IDS,
  OVERLAY_FONT_LABELS,
  OVERLAY_STYLES,
  OVERLAY_STYLE_LABELS,
  DEFAULT_TEXT_BACKING,
  LABEL_KINDS,
  LABEL_KIND_LABELS,
  TEXT_BACKINGS,
  TEXT_BACKING_LABELS,
  withLabelColor,
  withStyleLayout,
  PROFILE_HEIGHT_MAX,
  PROFILE_HEIGHT_MIN,
  PROFILE_WIDTH_MAX,
  PROFILE_WIDTH_MIN,
  WIDGET_SIZE_MAX,
  WIDGET_SIZE_MIN,
  withOverrides,
  withWidgetOffset,
  withWidgetOverrides,
  widgetOverrides,
} from '../overlay/settings'
import type { CounterId, LabelKind, OverlayFontId, OverlayOverrides, OverlaySettings, PlacedWidget, StyledWidget, TextBacking, WidgetOffset } from '../overlay/settings'
import { panelColorOf, resolveLabelStyle, resolveOverlayTheme, toHex } from '../overlay/themes'
import { getPlatform } from '../platform'
import { useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { AnchorPicker } from './AnchorPicker'
import { formatNumber, formatPercent } from './format'
import { PanelKeys } from './KeyControls'
import { InfoTip, PanelSection, RangeField, SettingRow, TextField } from './PanelSection'

const COUNTER_LABELS: Record<CounterId, string> = {
  distance: 'Distance',
  altitude: 'Altitude',
  ascent: 'Dénivelé positif',
  time: 'Temps écoulé',
  speed: 'Vitesse',
  heartRate: 'Fréquence cardiaque',
}

type WidgetKey = Exclude<keyof OverlaySettings, 'enabled' | 'style' | 'overrides'>

const percent = formatPercent

/** Names of the offset fields, by column and by row of the anchor (from the edge, or from the middle). */
const OFFSET_X_LABELS: Record<string, string> = { left: 'Depuis la gauche (px)', center: 'Vers la droite (px)', right: 'Depuis la droite (px)' }
const OFFSET_Y_LABELS: Record<string, string> = { top: 'Depuis le haut (px)', middle: 'Vers le bas (px)', bottom: 'Depuis le bas (px)' }

/**
 * Where a widget sits: its anchor on the 3 × 3 grid, then « Position libre », an offset in pixels of the exported film
 * from that corner of the safe area (the widget leaves its anchor's stack).
 */
export function WidgetPosition({ widget }: { widget: PlacedWidget }) {
  const id = useId()
  const overlay = useAppStore((s) => s.settings.overlay)
  const video = useAppStore((s) => s.settings.video)
  const set = (next: OverlaySettings) => useAppStore.getState().setSetting('overlay', next)
  const { anchor, offset } = overlay[widget]
  const [row, column] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-')
  const film = videoSize(video.aspect, video.resolution, Number.POSITIVE_INFINITY)
  const axis = (key: keyof WidgetOffset, label: string, current: WidgetOffset) => (
    <div className="field">
      <label className="field__label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        className="input"
        type="number"
        min={-OFFSET_MAX_PX}
        max={OFFSET_MAX_PX}
        step={1}
        value={current[key]}
        onChange={(e) => {
          const v = e.currentTarget.valueAsNumber
          if (!Number.isFinite(v)) return
          const px = Math.max(-OFFSET_MAX_PX, Math.min(OFFSET_MAX_PX, Math.round(v)))
          set(withWidgetOffset(overlay, widget, { ...current, [key]: px }))
        }}
      />
    </div>
  )
  return (
    <>
      <AnchorPicker label="Position" value={anchor} onChange={(next) => set({ ...overlay, [widget]: { ...overlay[widget], anchor: next } })} />
      <label className="checkbox">
        <input
          type="checkbox"
          checked={offset !== undefined}
          onChange={(e) => set(withWidgetOffset(overlay, widget, e.currentTarget.checked ? { x: 0, y: 0 } : null))}
        />
        Position libre
      </label>
      {offset && (
        <>
          <div className="position-offset">
            {axis('x', OFFSET_X_LABELS[column], offset)}
            {axis('y', OFFSET_Y_LABELS[row], offset)}
          </div>
          <p className="field__hint">
            En pixels du film exporté ({film.width} × {film.height}), depuis la marge de sécurité ; l'aperçu suit à l'échelle. Hors de la pile de sa
            position, l'élément peut chevaucher les autres.
          </p>
        </>
      )}
    </>
  )
}

export const SizeField = ({ value, onChange }: { value: number; onChange(v: number): void }) => (
  <RangeField label="Taille" min={WIDGET_SIZE_MIN} max={WIDGET_SIZE_MAX} step={0.1} value={value} format={(v) => `×${formatNumber(v, 1)}`} onChange={onChange} />
)

/** One widget: a checkbox that shows its options while it is enabled, its position first (out of the tabs). */
function WidgetGroup({
  label,
  enabled,
  onToggle,
  position,
  styled,
  style,
  visibility,
  children,
}: {
  label: string
  enabled: boolean
  onToggle(v: boolean): void
  /** where it sits (`WidgetPosition`), above the tabs */
  position?: PlacedWidget
  /** its own colours and fonts (« Couleurs et polices » at the end of its « Style » tab) */
  styled?: StyledWidget
  /** « Style » tab: size… */
  style?: ReactNode
  /** « Visibilité » tab: when it shows */
  visibility?: ReactNode
  /** « Contenu » tab: what it says */
  children?: ReactNode
}) {
  const id = useId()
  const tabs = WIDGET_TABS.filter((tab) => (tab === 'contenu' ? children : tab === 'style' ? style || styled : visibility))
  const [tab, setTab] = useState<WidgetTab>(tabs[0] ?? 'contenu')
  const shown = tabs.includes(tab) ? tab : tabs[0]
  return (
    <div className="overlay-widget" role="group" aria-labelledby={id}>
      <label className="checkbox checkbox--switch" id={id}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.currentTarget.checked)} />
        {label}
      </label>
      {enabled && (
        <div className="overlay-widget__body">
          {position && <WidgetPosition widget={position} />}
          {tabs.length > 1 && (
            <div className="overlay-widget__tabs segmented" role="group" aria-label={`Réglages de ${label}`}>
              {tabs.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="segmented__option"
                  aria-pressed={t === shown}
                  onClick={() => setTab(t)}
                >
                  {WIDGET_TAB_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          {shown === 'contenu' && children}
          {shown === 'style' && (
            <>
              {style}
              {styled && <WidgetStyleOverrides widget={styled} />}
            </>
          )}
          {shown === 'visibilite' && visibility}
        </div>
      )}
    </div>
  )
}

/**
 * The opening title or the closing card: its switch, here; its settings are those of its block on the timeline's
 * « Textes » lane (`CardFields`, in the inspector), which « Modifier » selects.
 */
function CardSwitch({ card, enabled, onToggle }: { card: CardId; enabled: boolean; onToggle(v: boolean): void }) {
  const id = useId()
  const hasTrack = useAppStore((s) => s.tracks.length > 0)
  const label = CARD_LABELS[card]
  return (
    <div className="overlay-widget" role="group" aria-labelledby={id}>
      <label className="checkbox checkbox--switch" id={id}>
        <input type="checkbox" checked={enabled} onChange={(e) => onToggle(e.currentTarget.checked)} />
        {label}
      </label>
      <p className="field__hint">Réglages : cliquez le bloc dans la timeline.</p>
      {enabled && (
        <button
          type="button"
          className="btn btn--secondary"
          disabled={!hasTrack}
          aria-label={`Modifier : ${label}`}
          onClick={() => useAppStore.getState().setFilmSelection(card)}
        >
          Modifier
        </button>
      )}
    </div>
  )
}

/** Tabs of the settings of an overlay element (only those it has). */
const WIDGET_TABS = ['contenu', 'style', 'visibilite'] as const
type WidgetTab = (typeof WIDGET_TABS)[number]
const WIDGET_TAB_LABELS: Record<WidgetTab, string> = { contenu: 'Contenu', style: 'Style', visibilite: 'Visibilité' }

/** A few colours of the film palette offered beside the colour picker. */
const SWATCHES: readonly { color: string; label: string }[] = [
  { color: '#ffffff', label: 'Blanc' },
  { color: '#f5f2ea', label: 'Papier' },
  { color: '#1c2a33', label: 'Encre' },
  { color: '#ff8a5c', label: 'Rouge clair' },
  { color: '#c23b22', label: 'Rouge' },
  { color: '#a9ccd9', label: 'Glacier' },
  { color: '#3f6b4a', label: 'Mousse' },
]

/**
 * Colour of the position dot of the profile or the mini-map: the 3D marker's until one is chosen (`value` '' or
 * absent), « Comme le marqueur » gives it back.
 */
function DotColor({ value, onChange }: { value: string | undefined; onChange(v: string): void }) {
  // '' of the marker settings: the colour of the track flown
  const marker = useAppStore((s) => s.settings.marker.color || filmTrackOf(s.tracks, s.settings.race)?.color || '#ffffff')
  return (
    <>
      <ColorField label="Point de position" value={value || marker} onChange={onChange} />
      <button type="button" className="btn btn--secondary" disabled={!value} onClick={() => onChange('')}>
        Comme le marqueur
      </button>
    </>
  )
}

/** Native colour picker followed by the swatches; `value` is '#rrggbb'. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="color-row">
        <input id={id} className="color-row__input" type="color" value={value} onChange={(e) => onChange(e.currentTarget.value)} />
        {SWATCHES.map((swatch) => (
          <button
            key={swatch.color}
            type="button"
            className="color-row__swatch"
            style={{ background: swatch.color }}
            aria-label={`${label} : ${swatch.label}`}
            aria-pressed={value === swatch.color}
            title={swatch.label}
            onClick={() => onChange(swatch.color)}
          />
        ))}
      </div>
    </div>
  )
}

/** Font of the titles or figures: the style's own, or one of the short list. */
function FontField({
  label,
  value,
  inherit = 'Celle du style',
  onChange,
}: {
  label: string
  value: OverlayFontId | undefined
  inherit?: string
  onChange(v: OverlayFontId | undefined): void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="select"
        value={value ?? ''}
        onChange={(e) => onChange((e.currentTarget.value || undefined) as OverlayFontId | undefined)}
      >
        <option value="">{inherit}</option>
        {OVERLAY_FONT_IDS.map((font) => (
          <option key={font} value={font}>
            {OVERLAY_FONT_LABELS[font]}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * « Couleur et police » of one text of the timeline: the overlay's until changed (the picker shows the colour drawn),
 * « Comme l'habillage » drops both.
 */
export function FilmTextStyleFields({
  color,
  font,
  onChange,
}: {
  color: string | undefined
  font: OverlayFontId | undefined
  onChange(patch: { color?: string; font?: OverlayFontId }): void
}) {
  const style = useAppStore((s) => s.settings.overlay.style)
  const overrides = useAppStore((s) => s.settings.overlay.overrides)
  const shown = color ?? toHex(resolveOverlayTheme(style, overrides).text)
  return (
    <SettingRow label="Couleur et police" value={color || font ? 'Personnalisées' : 'Comme l’habillage'}>
      <ColorField label="Couleur" value={shown} onChange={(c) => onChange({ color: c, font })} />
      <FontField label="Police" value={font} inherit="Celle de l'habillage" onChange={(f) => onChange({ color, font: f })} />
      <button type="button" className="btn btn--secondary" disabled={!color && !font} onClick={() => onChange({})}>
        Comme l'habillage
      </button>
    </SettingRow>
  )
}

/** « Couleurs et polices » of one widget (`StyleOverrides` on its own changes), in its panel group or in the inspector of a card. */
export function WidgetStyleOverrides({ widget }: { widget: StyledWidget }) {
  const overlay = useAppStore((s) => s.settings.overlay)
  return <StyleOverrides overlay={overlay} widget={widget} onChange={(patch) => useAppStore.getState().setSetting('overlay', withWidgetOverrides(overlay, widget, patch))} />
}

/**
 * « Couleurs et polices »: accent, text, panel and fonts changed on top of the style; the pickers show the colours
 * drawn (the style's until changed). « Revenir au style » drops every change. For one widget (`widget`): the same,
 * on top of the overlay's own changes, and « Comme le reste de l'habillage » drops the widget's.
 */
function StyleOverrides({
  overlay,
  widget,
  onChange,
}: {
  overlay: OverlaySettings
  widget?: StyledWidget
  onChange(patch: OverlayOverrides | null): void
}) {
  const theme = resolveOverlayTheme(overlay.style, widget ? widgetOverrides(overlay, widget) : overlay.overrides)
  const panel = panelColorOf(theme)
  const own = (widget ? overlay[widget].overrides : overlay.overrides) ?? {}
  const inherit = widget ? "Celle de l'habillage" : 'Celle du style'
  const backingId = useId()
  return (
    // a widget's own changes: no « modifié » badge (the paths stop at the widget, which has its other settings)
    <SettingRow
      label="Couleurs et polices"
      value={Object.keys(own).length > 0 ? 'Personnalisées' : widget ? 'Comme l’habillage' : 'Celles du style'}
      paths={widget ? [] : ['overlay.overrides']}
    >
      <ColorField label="Accent" value={toHex(theme.accent)} onChange={(accent) => onChange({ accent })} />
      <ColorField label="Texte" value={toHex(theme.text)} onChange={(text) => onChange({ text })} />
      {panel ? (
        <>
          <ColorField label="Fond des encarts" value={panel.color} onChange={(color) => onChange({ panel: color })} />
          <RangeField
            label="Opacité du fond"
            min={0}
            max={1}
            step={0.05}
            value={panel.opacity}
            format={percent}
            onChange={(panelOpacity) => onChange({ panelOpacity })}
          />
        </>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor={backingId}>
            Fond du texte
          </label>
          <select
            id={backingId}
            className="select"
            value={theme.textBacking ?? DEFAULT_TEXT_BACKING}
            onChange={(e) => onChange({ textBacking: e.currentTarget.value as TextBacking })}
          >
            {TEXT_BACKINGS.map((backing) => (
              <option key={backing} value={backing}>
                {TEXT_BACKING_LABELS[backing]}
              </option>
            ))}
          </select>
          <p className="field__hint">Ce style pose le texte sur l'image, sans fond d'encart.</p>
        </div>
      )}
      <FontField label="Police des titres" value={own.titleFont} inherit={inherit} onChange={(titleFont) => onChange({ titleFont })} />
      <FontField label="Police des chiffres" value={own.numberFont} inherit={inherit} onChange={(numberFont) => onChange({ numberFont })} />
      <button type="button" className="btn btn--secondary" disabled={Object.keys(own).length === 0} onClick={() => onChange(null)}>
        {widget ? "Comme le reste de l'habillage" : 'Revenir au style'}
      </button>
    </SettingRow>
  )
}

/** Kinds of 3D label shown in « Couleurs des étiquettes » (climbs have no label any more). */
const COLOURED_LABEL_KINDS = LABEL_KINDS.filter((kind) => kind !== 'climb')

/**
 * « Couleurs des étiquettes »: a list to pick the kind of 3D label (col, sommet, refuge…), then its colour (the
 * style's until changed). The labels also take the style's font and panel.
 */
function LabelColors({ overlay, onChange }: { overlay: OverlaySettings; onChange(next: OverlaySettings): void }) {
  const kindId = useId()
  const [kind, setKind] = useState<LabelKind>(COLOURED_LABEL_KINDS[0] ?? 'pass')
  const look = resolveLabelStyle(overlay.style, overlay.labelColors)
  const own = overlay.labelColors ?? {}
  return (
    <SettingRow
      label="Couleurs des étiquettes"
      value={Object.keys(own).length > 0 ? 'Personnalisées' : 'Celles du style'}
      paths={['overlay.labelColors']}
    >
      <div className="field">
        <label className="field__label" htmlFor={kindId}>
          Type d'étiquette
        </label>
        <select id={kindId} className="select" value={kind} onChange={(e) => setKind(e.currentTarget.value as LabelKind)}>
          {COLOURED_LABEL_KINDS.map((k) => (
            <option key={k} value={k}>
              {LABEL_KIND_LABELS[k]}
              {own[k] ? ' (modifiée)' : ''}
            </option>
          ))}
        </select>
      </div>
      <ColorField label="Couleur" value={toHex(look.accents[kind])} onChange={(color) => onChange(withLabelColor(overlay, kind, color))} />
      <p className="field__hint">La police et le fond des étiquettes suivent le style.</p>
      <button
        type="button"
        className="btn btn--secondary"
        disabled={Object.keys(own).length === 0}
        onClick={() => {
          const { labelColors: _labelColors, ...rest } = overlay
          onChange(rest)
        }}
      >
        Revenir aux couleurs du style
      </button>
    </SettingRow>
  )
}

/**
 * « Habillage » tab, in sections: Habillage (on / off, style, colours and fonts; « modifié / Par défaut » of the whole
 * overlay), Titres, Compteurs (and the ghost-race leaderboard, 2+ tracks), Profil et mini-carte, Météo, logo et texte, and Crédits des sources (burned in even without the rest).
 */
export function OverlayPanel() {
  const overlay = useAppStore((s) => s.settings.overlay)
  const setSetting = useAppStore((s) => s.setSetting)
  const track = useAppStore((s) => s.tracks[0])
  const severalTracks = useAppStore((s) => s.tracks.length >= 2)
  const raceOn = useAppStore((s) => s.settings.race.enabled)
  const hasWeather = useWeatherStore((s) => s.series !== null)
  const [logoError, setLogoError] = useState<string | null>(null)
  const id = useId()

  const set = (patch: Partial<OverlaySettings>) => setSetting('overlay', { ...overlay, ...patch })
  const setWidget = <K extends WidgetKey>(key: K, patch: Partial<OverlaySettings[K]>) => set({ [key]: { ...overlay[key], ...patch } })

  const hasTime = track?.stats.startTime !== undefined
  const hasEle = track?.stats.maxEle !== undefined
  const available: Record<CounterId, boolean> = {
    distance: true,
    altitude: !track || hasEle,
    ascent: !track || hasEle,
    time: !track || hasTime,
    speed: !track || hasMetric(track, 'speed'),
    heartRate: !track || hasMetric(track, 'heartRate'),
  }

  const chooseLogo = async () => {
    try {
      const [file] = await getPlatform().openFiles({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] })
      if (!file) return
      setLogoError(null)
      const image = await fileToLogoDataUrl(file)
      // the settings as they are now (another change or an undo may have happened during the decoding)
      const now = useAppStore.getState().settings.overlay
      setSetting('overlay', { ...now, logo: { ...now.logo, image } })
    } catch {
      setLogoError("Cette image n'a pas pu être lue.")
    }
  }

  return (
    <>
      <PanelSection title="Habillage" keys={['overlay']}>
        <label className="checkbox checkbox--switch">
          <input type="checkbox" checked={overlay.enabled} onChange={(e) => set({ enabled: e.currentTarget.checked })} />
          Afficher l'habillage
        </label>
        <p className="field__hint">Titres, compteurs et profil incrustés dans le film, tels qu'exportés.</p>

        {overlay.enabled && (
          <fieldset className="field fieldset">
            <legend className="field__label">Style</legend>
            <div className="segmented segmented--wrap">
              {OVERLAY_STYLES.map((style) => (
                <label key={style} className="segmented__option">
                  <input
                    type="radio"
                    name={`${id}-style`}
                    value={style}
                    checked={overlay.style === style}
                    onChange={() => set(withStyleLayout(overlay, style))}
                  />
                  {OVERLAY_STYLE_LABELS[style]}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {overlay.enabled && <StyleOverrides overlay={overlay} onChange={(patch) => setSetting('overlay', withOverrides(overlay, patch))} />}
        {overlay.enabled && <LabelColors overlay={overlay} onChange={(next) => setSetting('overlay', next)} />}
      </PanelSection>

      <PanelSection title="Étiquettes 3D">
        <p className="field__hint">Toujours affichées. Posez des clés pour les masquer puis les faire revenir en fondu le long du parcours : une clé à 100 % les affiche, à 0 % les masque (deux clés proches font un changement rapide).</p>
        <PanelKeys target={{ kind: 'param', param: 'labels' }} />
      </PanelSection>

      {overlay.enabled && (
        <>
          <PanelSection title="Titres">
            <CardSwitch card={TITLE_CARD_ID} enabled={overlay.title.enabled} onToggle={(enabled) => setWidget('title', { enabled })} />
            <CardSwitch card={END_CARD_ID} enabled={overlay.end.enabled} onToggle={(enabled) => setWidget('end', { enabled })} />
          </PanelSection>

          <PanelSection title="Compteurs">
            <WidgetGroup
              label="Afficher les compteurs"
              enabled={overlay.counters.enabled}
              onToggle={(enabled) => setWidget('counters', { enabled })}
              position="counters"
              styled="counters"
              style={<SizeField value={overlay.counters.size} onChange={(size) => setWidget('counters', { size })} />}
            >
              <fieldset className="field fieldset">
                <legend className="field__label">Valeurs</legend>
                <div className="chips">
                  {COUNTER_IDS.map((counter) => (
                    <label key={counter} className="chip" title={available[counter] ? undefined : 'Absent de cette trace'}>
                      <input
                        type="checkbox"
                        checked={overlay.counters.fields[counter] && available[counter]}
                        disabled={!available[counter]}
                        onChange={(e) => setWidget('counters', { fields: { ...overlay.counters.fields, [counter]: e.currentTarget.checked } })}
                      />
                      {COUNTER_LABELS[counter]}
                    </label>
                  ))}
                </div>
              </fieldset>
            </WidgetGroup>

            {severalTracks && (
              <WidgetGroup
                label="Classement (course fantôme)"
                enabled={overlay.leaderboard.enabled}
                onToggle={(enabled) => setWidget('leaderboard', { enabled })}
                position="leaderboard"
                styled="leaderboard"
                style={<SizeField value={overlay.leaderboard.size} onChange={(size) => setWidget('leaderboard', { size })} />}
              >
                <p className="field__hint">
                  {raceOn
                    ? 'Rang, nom et écart au premier de chaque trace, au marqueur.'
                    : 'Visible quand les traces sont rejouées « En parallèle » (onglet Trace, « Plusieurs traces »).'}
                </p>
              </WidgetGroup>
            )}
          </PanelSection>

          <PanelSection title="Profil et mini-carte">
            <WidgetGroup
              label="Profil altimétrique"
              enabled={overlay.profile.enabled}
              onToggle={(enabled) => setWidget('profile', { enabled })}
              position="profile"
              styled="profile"
              style={
                <>
                  <RangeField
                    label="Largeur (% de l'image)"
                    min={PROFILE_WIDTH_MIN}
                    max={PROFILE_WIDTH_MAX}
                    step={0.01}
                    value={overlay.profile.width}
                    format={percent}
                    onChange={(width) => setWidget('profile', { width })}
                  />
                  <RangeField
                    label="Hauteur (% de l'image)"
                    min={PROFILE_HEIGHT_MIN}
                    max={PROFILE_HEIGHT_MAX}
                    step={0.01}
                    value={overlay.profile.height}
                    format={percent}
                    onChange={(height) => setWidget('profile', { height })}
                  />
                  <DotColor value={overlay.profile.markerColor} onChange={(markerColor) => setWidget('profile', { markerColor })} />
                </>
              }
            >
              {!hasEle && track && <p className="field__hint">Cette trace n'a pas d'altitude enregistrée.</p>}
            </WidgetGroup>

            <WidgetGroup
              label="Mini-carte"
              enabled={overlay.minimap.enabled}
              onToggle={(enabled) => setWidget('minimap', { enabled })}
              position="minimap"
              styled="minimap"
              style={
                <>
                  <SizeField value={overlay.minimap.size} onChange={(size) => setWidget('minimap', { size })} />
                  <DotColor value={overlay.minimap.markerColor} onChange={(markerColor) => setWidget('minimap', { markerColor })} />
                </>
              }
            >
              <p className="field__hint">Tout le tracé vu de dessus, nord en haut, avec la position.</p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={overlay.minimap.northArrow}
                  onChange={(e) => setWidget('minimap', { northArrow: e.currentTarget.checked })}
                />
                Flèche du nord
              </label>
            </WidgetGroup>
          </PanelSection>

          <PanelSection title="Météo, logo et texte">
            <WidgetGroup
              label="Météo"
              enabled={overlay.weather.enabled}
              onToggle={(enabled) => setWidget('weather', { enabled })}
              position="weather"
              styled="weather"
              style={<SizeField value={overlay.weather.size} onChange={(size) => setWidget('weather', { size })} />}
            >
              <p className="field__hint">
                {hasWeather
                  ? 'Ciel, température et vent au marqueur.'
                  : 'Disponible quand la météo de la sortie est chargée (onglet Trace).'}
              </p>
            </WidgetGroup>

            <WidgetGroup
              label="Logo"
              enabled={overlay.logo.enabled}
              onToggle={(enabled) => setWidget('logo', { enabled })}
              position="logo"
              style={
                <>
                  <SizeField value={overlay.logo.size} onChange={(size) => setWidget('logo', { size })} />
                  <RangeField
                    label="Opacité"
                    min={0}
                    max={1}
                    step={0.05}
                    value={overlay.logo.opacity}
                    format={percent}
                    onChange={(opacity) => setWidget('logo', { opacity })}
                  />
                </>
              }
            >
              <div className="project__row">
                <button type="button" className="btn btn--secondary" onClick={() => void chooseLogo()}>
                  {overlay.logo.image ? "Changer l'image" : 'Choisir une image'}
                </button>
                {overlay.logo.image && (
                  <button type="button" className="btn btn--secondary" onClick={() => setWidget('logo', { image: '' })}>
                    Retirer
                  </button>
                )}
              </div>
              {logoError && (
                <p className="field__hint" role="alert">
                  {logoError}
                </p>
              )}
            </WidgetGroup>

            <WidgetGroup
              label="Texte libre"
              enabled={overlay.text.enabled}
              onToggle={(enabled) => setWidget('text', { enabled })}
              position="text"
              styled="text"
              style={<SizeField value={overlay.text.size} onChange={(size) => setWidget('text', { size })} />}
            >
              <TextField label="Texte" value={overlay.text.text} placeholder="Ex. : avec Marie et Paul" onChange={(text) => setWidget('text', { text })} />
            </WidgetGroup>
          </PanelSection>
        </>
      )}

      <PanelSection title="Crédits des sources">
        <div className="field__label-row">
          <label className="checkbox checkbox--switch">
            <input type="checkbox" checked={overlay.credits.enabled} onChange={(e) => setWidget('credits', { enabled: e.currentTarget.checked })} />
            Incruster les crédits
          </label>
          <InfoTip text="Les licences du relief, de l'imagerie, de la météo et d'OpenStreetMap demandent de citer les sources dans le film publié." />
        </div>
        {overlay.credits.enabled ? (
          <>
            <AnchorPicker
              label="Position"
              value={overlay.credits.position}
              allowed={CREDITS_POSITIONS}
              onChange={(position) => setWidget('credits', { position })}
            />
            <p className="field__hint">En petit, dans un coin de chaque image exportée, même sans le reste de l'habillage.</p>
          </>
        ) : (
          <p className="field__hint">Citez alors les sources ailleurs (description de la vidéo, générique).</p>
        )}
      </PanelSection>
    </>
  )
}
