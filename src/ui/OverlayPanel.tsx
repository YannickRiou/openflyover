import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CARD_LABELS, END_CARD_ID, TITLE_CARD_ID } from '../film/cards'
import { t, useT } from '../i18n'
import type { CardId } from '../film/cards'
import { filmTrackOf, playsBilan, playsInSequence } from '../flyover/sequence'
import { hasMetric } from '../flyover/trackColor'
import { fileToLogoDataUrl } from '../overlay/assets'
import {
  BILAN_COUNTERS,
  COUNTER_IDS,
  CREDITS_MODES,
  CREDITS_POSITIONS,
  OFFSET_MAX,
  OVERLAY_FONT_IDS,
  OVERLAY_FONT_LABELS,
  OVERLAY_STYLES,
  OVERLAY_STYLE_LABELS,
  DEFAULT_LOGO,
  DEFAULT_TEXT_BACKING,
  LABEL_KINDS,
  LOGOS_MAX,
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
  withWidgetAnchor,
  withWidgetOffset,
  withWidgetOverrides,
  inStyleSlot,
  placedSettings,
} from '../overlay/settings'
import type { CounterId, LabelKind, LogoSettings, OverlayAnchor, OverlayFontId, OverlayOverrides, OverlaySettings, OverlayStyleId, PlacedWidget, StyledWidget, WidgetOffset } from '../overlay/settings'
import { showToast } from './toast'
import { panelColorOf, resolveLabelStyle, resolveOverlayTheme, toHex } from '../overlay/themes'
import { getPlatform } from '../platform'
import { getSettingsHistory } from '../project/history'
import { DEFAULT_SETTINGS, useAppStore } from '../state/store'
import { useWeatherStore } from '../weather/store'
import { AnchorPicker } from './AnchorPicker'
import { formatNumber, formatPercent } from './format'
import { PanelKeys } from './KeyControls'
import { LabelSettings } from './LabelSettings'
import { InfoTip, ModeGate, PanelSection, RangeField, SettingRow } from './PanelSection'
import { Button, Checkbox, Chip, ColorField as ColorFieldControl, NumberField, Radio, RadioGroup, Select, Switch, TextField, ToggleButton, ToggleButtonGroup } from './primitives'

const COUNTER_LABELS: Record<CounterId, string> = {
  get distance() { return t('overlay.counter.distance') },
  get altitude() { return t('overlay.counter.altitude') },
  get ascent() { return t('overlay.counter.ascent') },
  get time() { return t('overlay.counter.time') },
  get speed() { return t('overlay.counter.speed') },
  get heartRate() { return t('overlay.counter.heartRate') },
  get slope() { return t('overlay.counter.slope') },
  get clock() { return t('overlay.counter.clock') },
  get pace() { return t('overlay.counter.pace') },
  get power() { return t('overlay.counter.power') },
  get temperature() { return t('overlay.counter.temperature') },
  get outings() { return t('overlay.counter.outings') },
}

type WidgetKey = Exclude<keyof OverlaySettings, 'enabled' | 'style' | 'overrides' | 'logos'>

const percent = formatPercent

/** Names of the offset fields, by column and by row of the anchor (from the edge, or from the middle). */
const OFFSET_X_LABELS: Record<string, string> = {
  get left() { return t('overlay.offset.left') },
  get center() { return t('overlay.offset.center') },
  get right() { return t('overlay.offset.right') },
}
const OFFSET_Y_LABELS: Record<string, string> = {
  get top() { return t('overlay.offset.top') },
  get middle() { return t('overlay.offset.middle') },
  get bottom() { return t('overlay.offset.bottom') },
}

/**
 * A free position typed in percent of the safe area, digit by digit: a value in range is applied at once, Enter or
 * leaving the field rounds and clamps it, an empty or invalid entry puts the stored value back. One undo step per edit
 * (focus to blur).
 */
function OffsetField({ id, label, value, onCommit }: { id: string; label: string; value: number; onCommit(share: number): void }) {
  const endGesture = useRef<(() => void) | null>(null)
  const stop = () => {
    endGesture.current?.()
    endGesture.current = null
  }
  useEffect(() => stop, [])
  return (
    <NumberField
      id={id}
      label={label}
      min={-100 * OFFSET_MAX}
      max={100 * OFFSET_MAX}
      step={1}
      live
      value={Math.round(100 * value)}
      onFocus={() => {
        endGesture.current ??= getSettingsHistory().beginGesture()
      }}
      onChange={(percent) => onCommit(Math.round(percent) / 100)}
      onBlur={stop}
    />
  )
}

/**
 * Where a widget sits: its anchor on the 3 × 3 grid, then « Position libre », a share of the safe area from that corner
 * of it (the widget leaves its anchor's stack).
 */
export function WidgetPosition({ widget, index = 0 }: { widget: PlacedWidget; index?: number }) {
  const t = useT()
  const overlay = useAppStore((s) => s.settings.overlay)
  const set = (next: OverlaySettings) => useAppStore.getState().setSetting('overlay', next)
  const { anchor, free } = placedSettings(overlay, widget, index)
  return (
    <>
      <AnchorPicker label={t('overlay.position')} value={anchor} onChange={(next) => set(withWidgetAnchor(overlay, widget, next, index))} />
      <FreePosition anchor={anchor} free={free} onChange={(next) => set(withWidgetOffset(overlay, widget, next, index))} />
    </>
  )
}

/** « Position libre » from `anchor`: a tick, then the two shares of the safe area (null: back at the anchor). */
export function FreePosition({ anchor, free, onChange }: { anchor: OverlayAnchor; free: WidgetOffset | undefined; onChange(free: WidgetOffset | null): void }) {
  const t = useT()
  const id = useId()
  const [row, column] = anchor === 'center' ? ['middle', 'center'] : anchor.split('-')
  const axis = (key: keyof WidgetOffset, label: string, current: WidgetOffset) => (
    <OffsetField id={`${id}-${key}`} label={label} value={current[key]} onCommit={(share) => onChange({ ...current, [key]: share })} />
  )
  return (
    <>
      <Checkbox checked={free !== undefined} onChange={(on) => onChange(on ? { x: 0, y: 0 } : null)}>
        {t('overlay.freePosition')}
      </Checkbox>
      {free && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {axis('x', OFFSET_X_LABELS[column], free)}
            {axis('y', OFFSET_Y_LABELS[row], free)}
          </div>
          <p className="type-hint">{t('overlay.freePositionHint')}</p>
        </>
      )}
    </>
  )
}

export const SizeField = ({ value, onChange }: { value: number; onChange(v: number): void }) => (
  <RangeField label={t('overlay.size')} min={WIDGET_SIZE_MIN} max={WIDGET_SIZE_MAX} step={0.1} value={value} defaultValue={1} format={(v) => `×${formatNumber(v, 1)}`} onChange={onChange} />
)

/** A widget of the overlay: its switch under a hairline (none above the first of a section), its options nested under a rule. */
const WIDGET = 'flex flex-col gap-2 border-t border-edge pt-3 first:border-t-0 first:pt-0'
const WIDGET_BODY = 'ml-3.5 flex flex-col gap-3 border-l-2 border-edge pl-3'

/** One widget: a checkbox that shows its options while it is enabled, its position first (out of the tabs). */
function WidgetGroup({
  label,
  enabled,
  onToggle,
  position,
  positionIndex,
  styled,
  style,
  children,
}: {
  label: string
  enabled: boolean
  onToggle(v: boolean): void
  /** where it sits (`WidgetPosition`), above the tabs */
  position?: PlacedWidget
  /** the logo number of `position` 'logo' */
  positionIndex?: number
  /** its own colours and fonts (« Couleurs et polices » at the end of its « Style » tab) */
  styled?: StyledWidget
  /** « Style » tab: size… */
  style?: ReactNode
  /** « Contenu » tab: what it says */
  children?: ReactNode
}) {
  const tr = useT()
  const id = useId()
  const tabs = WIDGET_TABS.filter((tab) => (tab === 'contenu' ? children : style || styled))
  const [tab, setTab] = useState<WidgetTab>(tabs[0] ?? 'contenu')
  const shown = tabs.includes(tab) ? tab : tabs[0]
  return (
    <div className={WIDGET} role="group" aria-labelledby={id}>
      <Switch id={id} checked={enabled} onChange={(on) => onToggle(on)}>{label}</Switch>
      {enabled && (
        <div className={WIDGET_BODY}>
          {position && <WidgetPosition widget={position} index={positionIndex} />}
          {tabs.length > 1 && (
            <ToggleButtonGroup aria-label={tr('overlay.widgetSettings', { label })} value={shown} onChange={(next) => setTab(next)}>
              {tabs.map((t) => (
                <ToggleButton key={t} value={t}>
                  {WIDGET_TAB_LABELS[t]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
          {shown === 'contenu' && children}
          {shown === 'style' && (
            <>
              {style}
              {styled && <WidgetStyleOverrides widget={styled} />}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * The opening title or the closing card: its switch, here; its settings are those of its block on the timeline's
 * « Textes » lane (`CardFields`, in the inspector), which « Modifier » selects.
 */
/** The overlay in `style`; when the style puts widgets back in its places, a message says so, with « Annuler ». */
function changeStyle(overlay: OverlaySettings, style: OverlayStyleId): void {
  const next = withStyleLayout(overlay, style)
  useAppStore.getState().setSetting('overlay', next)
  const moved = (['title', 'end', 'counters', 'profile', 'minimap', 'weather'] as const).some((key) => JSON.stringify(next[key]) !== JSON.stringify(overlay[key]))
  if (!moved) return
  const history = getSettingsHistory()
  showToast({ kind: 'info', text: t('overlay.panel.styleMoved', { style: OVERLAY_STYLE_LABELS[style] }), action: { label: t('common.undo'), run: () => history.undo() } })
}

function CardSwitch({ card, enabled, onToggle }: { card: CardId; enabled: boolean; onToggle(v: boolean): void }) {
  const t = useT()
  const id = useId()
  const hasTrack = useAppStore((s) => s.tracks.length > 0)
  // « À la suite », the opening title takes the place of the first stage's card
  const sequence = useAppStore((s) => playsInSequence(s.settings.race, s.tracks.length))
  const label = CARD_LABELS[card]
  return (
    <div className={WIDGET} role="group" aria-labelledby={id}>
      <Switch id={id} checked={enabled} onChange={(on) => onToggle(on)}>{label}</Switch>
      <p className="type-hint">{t('overlay.card.hint')}</p>
      {card === TITLE_CARD_ID && sequence && <p className="type-hint">{t('overlay.card.replacesFirstStage')}</p>}
      {enabled && (
        <Button
          disabled={!hasTrack}
          aria-label={t('overlay.card.editAria', { label })}
          onClick={() => useAppStore.getState().setFilmSelection(card)}
        >
          {t('overlay.card.edit')}
        </Button>
      )}
    </div>
  )
}

/** Tabs of the settings of an overlay element (only those it has). */
const WIDGET_TABS = ['contenu', 'style'] as const
type WidgetTab = (typeof WIDGET_TABS)[number]
const WIDGET_TAB_LABELS: Record<WidgetTab, string> = {
  get contenu() { return t('overlay.tab.contenu') },
  get style() { return t('overlay.tab.style') },
}

/** A few colours of the film palette offered beside the colour picker. */
const SWATCHES: readonly { color: string; label: string }[] = [
  { color: '#ffffff', get label() { return t('overlay.swatch.white') } },
  { color: '#f5f2ea', get label() { return t('overlay.swatch.paper') } },
  { color: '#1c2a33', get label() { return t('overlay.swatch.ink') } },
  { color: '#ff8a5c', get label() { return t('overlay.swatch.lightRed') } },
  { color: '#c23b22', get label() { return t('overlay.swatch.red') } },
  { color: '#a9ccd9', get label() { return t('overlay.swatch.glacier') } },
  { color: '#3f6b4a', get label() { return t('overlay.swatch.moss') } },
]

/**
 * Colour of the position dot of the profile or the mini-map: the 3D marker's until one is chosen (`value` '' or
 * absent), « Comme le marqueur » gives it back.
 */
function DotColor({ value, onChange }: { value: string | undefined; onChange(v: string): void }) {
  const t = useT()
  // '' of the marker settings: the colour of the track flown
  const marker = useAppStore((s) => s.settings.marker.color || filmTrackOf(s.tracks, s.settings.race)?.color || '#ffffff')
  return (
    <>
      <ColorField label={t('overlay.dotColor')} value={value || marker} onChange={onChange} />
      <Button disabled={!value} onClick={() => onChange('')}>
        {t('overlay.sameAsMarker')}
      </Button>
    </>
  )
}

/** The colour button followed by the swatches; `value` is '#rrggbb'. */
function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  const t = useT()
  const id = useId()
  return (
    <div className="field">
      <label className="type-label" htmlFor={id}>
        {label}
      </label>
      <ColorFieldControl
        id={id}
        label={label}
        value={value}
        onChange={onChange}
        presets={SWATCHES.map((swatch) => ({ color: swatch.color, label: swatch.label, aria: t('overlay.swatchAria', { label, swatch: swatch.label }) }))}
      />
    </div>
  )
}

/** Font of the titles or figures: the style's own, or one of the short list. */
function FontField({
  label,
  value,
  inherit,
  onChange,
}: {
  label: string
  value: OverlayFontId | undefined
  inherit?: string
  onChange(v: OverlayFontId | undefined): void
}) {
  const t = useT()
  const id = useId()
  return (
    <div className="field">
      <label className="type-label" htmlFor={id}>
        {label}
      </label>
      <Select
        id={id}
        value={value ?? ''}
        options={[{ value: '', label: inherit ?? t('overlay.font.style') }, ...OVERLAY_FONT_IDS.map((font) => ({ value: font, label: OVERLAY_FONT_LABELS[font] }))]}
        onChange={(font) => onChange(font || undefined)}
      />
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
  const t = useT()
  const style = useAppStore((s) => s.settings.overlay.style)
  const overrides = useAppStore((s) => s.settings.overlay.overrides)
  const shown = color ?? toHex(resolveOverlayTheme(style, overrides).text)
  return (
    <SettingRow label={t('overlay.textStyle.title')} value={color || font ? t('overlay.custom') : t('overlay.sameAsOverlay')}>
      <ColorField label={t('overlay.color')} value={shown} onChange={(c) => onChange({ color: c, font })} />
      <FontField label={t('overlay.font')} value={font} inherit={t('overlay.font.overlay')} onChange={(f) => onChange({ color, font: f })} />
      <Button disabled={!color && !font} onClick={() => onChange({})}>
        {t('overlay.sameAsOverlayButton')}
      </Button>
    </SettingRow>
  )
}

/**
 * The fonts each widget draws with (overlay/draw.ts, overlay/structures.ts): the cards their title in the title font and
 * their figures in the number font; the counters, the leaderboard and the weather their figures only; the profile, the
 * mini-map and the free text the body font of the style, which neither changes. A font a widget does not read is not offered.
 */
const WIDGET_FONTS: Record<StyledWidget, { title: boolean; number: boolean }> = {
  title: { title: true, number: true },
  end: { title: true, number: true },
  counters: { title: false, number: true },
  leaderboard: { title: false, number: true },
  weather: { title: false, number: true },
  profile: { title: false, number: false },
  minimap: { title: false, number: false },
  text: { title: false, number: false },
}

/** « Couleurs et polices » of one widget (`StyleOverrides` on its own changes), in its panel group or in the inspector of a card. */
export function WidgetStyleOverrides({ widget }: { widget: StyledWidget }) {
  const overlay = useAppStore((s) => s.settings.overlay)
  return (
    <StyleOverrides
      overlay={overlay}
      own={overlay[widget].overrides ?? {}}
      fonts={WIDGET_FONTS[widget]}
      onChange={(patch) => useAppStore.getState().setSetting('overlay', withWidgetOverrides(overlay, widget, patch))}
    />
  )
}

/**
 * « Couleurs et polices »: accent, text, panel and fonts changed on top of the style; the pickers show the colours
 * drawn (the style's until changed). « Revenir au style » drops every change. For one widget or card (`own`, its own
 * changes, {} while it has none): the same, on top of the overlay's own changes, and « Comme le reste de
 * l'habillage » drops them.
 */
export function StyleOverrides({
  overlay,
  own: widgetOwn,
  fonts = { title: true, number: true },
  onChange,
}: {
  overlay: OverlaySettings
  own?: OverlayOverrides
  /** the fonts the widget reads (`WIDGET_FONTS`); the whole overlay reads both */
  fonts?: { title: boolean; number: boolean }
  onChange(patch: OverlayOverrides | null): void
}) {
  const t = useT()
  const widget = widgetOwn !== undefined
  const own = (widget ? widgetOwn : overlay.overrides) ?? {}
  const theme = resolveOverlayTheme(overlay.style, widget ? { ...overlay.overrides, ...widgetOwn } : overlay.overrides)
  const panel = panelColorOf(theme)
  const inherit = widget ? t('overlay.font.overlay') : t('overlay.font.style')
  const backingId = useId()
  return (
    // a widget's own changes: no « modifié » badge (the paths stop at the widget, which has its other settings)
    <SettingRow
      label={t('overlay.overrides.title')}
      value={Object.keys(own).length > 0 ? t('overlay.custom') : widget ? t('overlay.sameAsOverlay') : t('overlay.overrides.style')}
      paths={widget ? [] : ['overlay.overrides']}
    >
      <ColorField label={t('overlay.overrides.accent')} value={toHex(theme.accent)} onChange={(accent) => onChange({ accent })} />
      <ColorField label={t('overlay.overrides.text')} value={toHex(theme.text)} onChange={(text) => onChange({ text })} />
      {panel ? (
        <>
          <ColorField label={t('overlay.overrides.panel')} value={panel.color} onChange={(color) => onChange({ panel: color })} />
          <RangeField
            label={t('overlay.overrides.panelOpacity')}
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
          <label className="type-label" htmlFor={backingId}>
            {t('overlay.overrides.backing')}
          </label>
          <Select
            id={backingId}
            value={theme.textBacking ?? DEFAULT_TEXT_BACKING}
            options={TEXT_BACKINGS.map((backing) => ({ value: backing, label: TEXT_BACKING_LABELS[backing] }))}
            onChange={(textBacking) => onChange({ textBacking })}
          />
          <p className="type-hint">{t('overlay.overrides.backingHint')}</p>
        </div>
      )}
      {fonts.title && <FontField label={t('overlay.overrides.titleFont')} value={own.titleFont} inherit={inherit} onChange={(titleFont) => onChange({ titleFont })} />}
      {fonts.number && <FontField label={t('overlay.overrides.numberFont')} value={own.numberFont} inherit={inherit} onChange={(numberFont) => onChange({ numberFont })} />}
      <Button disabled={Object.keys(own).length === 0} onClick={() => onChange(null)}>
        {widget ? t('overlay.overrides.restOfOverlay') : t('overlay.overrides.backToStyle')}
      </Button>
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
  const t = useT()
  const kindId = useId()
  const [kind, setKind] = useState<LabelKind>(COLOURED_LABEL_KINDS[0] ?? 'pass')
  const look = resolveLabelStyle(overlay.style, overlay.labelColors)
  const own = overlay.labelColors ?? {}
  return (
    <SettingRow
      label={t('overlay.labelColors.title')}
      value={Object.keys(own).length > 0 ? t('overlay.custom') : t('overlay.overrides.style')}
      paths={['overlay.labelColors']}
      min="expert"
    >
      <div className="field">
        <label className="type-label" htmlFor={kindId}>
          {t('overlay.labelColors.type')}
        </label>
        <Select
          id={kindId}
          value={kind}
          options={COLOURED_LABEL_KINDS.map((k) => ({ value: k, label: `${LABEL_KIND_LABELS[k]}${own[k] ? t('overlay.labelColors.changed') : ''}` }))}
          onChange={(k) => setKind(k)}
        />
      </div>
      <ColorField label={t('overlay.color')} value={toHex(look.accents[kind])} onChange={(color) => onChange(withLabelColor(overlay, kind, color))} />
      <p className="type-hint">{t('overlay.labelColors.hint')}</p>
      <Button
        disabled={Object.keys(own).length === 0}
        onClick={() => {
          const { labelColors: _labelColors, ...rest } = overlay
          onChange(rest)
        }}
      >
        {t('overlay.labelColors.back')}
      </Button>
    </SettingRow>
  )
}

/**
 * « Habillage » tab, in sections: Habillage (on / off, style, colours and fonts; « modifié / Par défaut » of the whole
 * overlay), Titres, Compteurs (and the ghost-race leaderboard, 2+ tracks), Profil et mini-carte, Météo, logo et texte, and Crédits des sources (burned in even without the rest).
 */
export function OverlayPanel() {
  const t = useT()
  const overlay = useAppStore((s) => s.settings.overlay)
  const labels = useAppStore((s) => s.settings.labels)
  const setSetting = useAppStore((s) => s.setSetting)
  const track = useAppStore((s) => s.tracks[0])
  const severalTracks = useAppStore((s) => s.tracks.length >= 2)
  const raceOn = useAppStore((s) => s.settings.race.enabled)
  const bilan = useAppStore((s) => playsBilan(s.settings.race, s.tracks.length))
  const hasWeather = useWeatherStore((s) => s.series !== null)
  // place in the list of the logo whose image could not be read
  const [logoError, setLogoError] = useState<number | null>(null)

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
    slope: !track || hasMetric(track, 'slope'),
    clock: !track || hasTime,
    pace: !track || hasMetric(track, 'speed'),
    power: !track || hasMetric(track, 'power'),
    temperature: !track || hasMetric(track, 'temperature'),
    outings: true,
  }
  // a « Bilan » counts the outings: only the figures that add up have a counter there
  const counterShown = (counter: CounterId) => (counter === 'outings' ? bilan : true)
  const counterOn = (counter: CounterId) => available[counter] && (!bilan || BILAN_COUNTERS.includes(counter))

  const setLogo = (index: number, patch: Partial<LogoSettings>) => set({ logos: overlay.logos.map((logo, i) => (i === index ? { ...logo, ...patch } : logo)) })

  const chooseLogo = async (index: number) => {
    try {
      const [file] = await getPlatform().openFiles({ filters: [{ name: t('marker.image.filter'), extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }] })
      if (!file) return
      setLogoError(null)
      const image = await fileToLogoDataUrl(file)
      // the settings as they are now (another change or an undo may have happened during the decoding)
      const now = useAppStore.getState().settings.overlay
      setSetting('overlay', { ...now, logos: now.logos.map((logo, i) => (i === index ? { ...logo, image } : logo)) })
    } catch {
      setLogoError(index)
    }
  }

  return (
    <>
      <PanelSection title={t('overlay.panel.title')} summary={OVERLAY_STYLE_LABELS[overlay.style]} keys={['overlay']}>
        <Switch checked={overlay.enabled} onChange={(on) => set({ enabled: on })}>{t('overlay.panel.show')}</Switch>
        <p className="type-hint">{t('overlay.panel.showHint')}</p>

        {/* the style also draws the 3D labels, the texts and the credits of the film, with the overlay off */}
        <fieldset className="field min-w-0">
          <legend className="type-label mb-1">{t('overlay.panel.style')}</legend>
          <RadioGroup wrap aria-label={t('overlay.panel.style')} value={overlay.style} onChange={(style) => changeStyle(overlay, style)}>
            {OVERLAY_STYLES.map((style) => (
              <Radio key={style} value={style}>
                {OVERLAY_STYLE_LABELS[style]}
              </Radio>
            ))}
          </RadioGroup>
          <p className="type-hint">{t('overlay.panel.styleHint')}</p>
        </fieldset>
        <ModeGate min="expert" paths={['overlay.overrides']}>
          <StyleOverrides overlay={overlay} onChange={(patch) => setSetting('overlay', withOverrides(overlay, patch))} />
        </ModeGate>
      </PanelSection>

      {/* the titles have their own switches: shown whether the rest of the overlay is or not */}
      <PanelSection
        title={t('overlay.panel.titles')}
        summary={[overlay.title.enabled && CARD_LABELS[TITLE_CARD_ID], overlay.end.enabled && CARD_LABELS[END_CARD_ID]].filter(Boolean).join(' · ') || t('common.off')}
      >
        <CardSwitch card={TITLE_CARD_ID} enabled={overlay.title.enabled} onToggle={(enabled) => setWidget('title', { enabled })} />
        <CardSwitch card={END_CARD_ID} enabled={overlay.end.enabled} onToggle={(enabled) => setWidget('end', { enabled })} />
      </PanelSection>

      {/* every setting of the 3D labels in one place: what shows, size and range, colours, keys along the way */}
      <PanelSection
        title={t('overlay.panel.labels3d')}
        summary={`${t('track.labels.sizeShort')} ×${formatNumber(labels.size, 1)} · ${t('track.labels.rangeShort')} ${formatNumber(labels.rangeKm)} km`}
        keys={['labels']}
        min="confirme"
      >
        <LabelSettings />
        <LabelColors overlay={overlay} onChange={(next) => setSetting('overlay', next)} />
        <p className="type-hint">{t('overlay.panel.labels3dHint')}</p>
        <p className="type-hint">{t('overlay.panel.labels3dWhich')}</p>
        <PanelKeys target={{ kind: 'param', param: 'labels' }} />
      </PanelSection>

      {overlay.enabled && (
        <>
          <PanelSection
            title={t('overlay.panel.counters')}
            summary={overlay.counters.enabled ? t('common.on') : t('common.off')}
            min="confirme"
            paths={['overlay.counters', 'overlay.leaderboard']}
          >
            <WidgetGroup
              label={t('overlay.panel.showCounters')}
              enabled={overlay.counters.enabled}
              onToggle={(enabled) => setWidget('counters', { enabled })}
              position="counters"
              styled="counters"
              style={<SizeField value={overlay.counters.size} onChange={(size) => setWidget('counters', { size })} />}
            >
              <fieldset className="field min-w-0">
                <legend className="type-label mb-1">{t('overlay.panel.values')}</legend>
                <div className="chips">
                  {COUNTER_IDS.filter(counterShown).map((counter) => (
                    <Chip
                      key={counter}
                      checked={overlay.counters.fields[counter] && counterOn(counter)}
                      disabled={!counterOn(counter)}
                      title={counterOn(counter) ? undefined : bilan && available[counter] ? t('overlay.panel.notInBilan') : t('overlay.panel.missing')}
                      onChange={(on) => setWidget('counters', { fields: { ...overlay.counters.fields, [counter]: on } })}
                    >
                      {COUNTER_LABELS[counter]}
                    </Chip>
                  ))}
                </div>
                {bilan && <p className="type-hint">{t('overlay.panel.bilanCounters')}</p>}
              </fieldset>
            </WidgetGroup>

            {/* drawn only for a race in parallel */}
            {severalTracks && raceOn && (
              <WidgetGroup
                label={t('overlay.panel.leaderboard')}
                enabled={overlay.leaderboard.enabled}
                onToggle={(enabled) => setWidget('leaderboard', { enabled })}
                position="leaderboard"
                styled="leaderboard"
                style={<SizeField value={overlay.leaderboard.size} onChange={(size) => setWidget('leaderboard', { size })} />}
              >
                <p className="type-hint">{t('overlay.panel.leaderboardRace')}</p>
              </WidgetGroup>
            )}
          </PanelSection>

          <PanelSection
            title={t('overlay.panel.profileMinimap')}
            summary={[overlay.profile.enabled && t('overlay.panel.profile'), overlay.minimap.enabled && t('overlay.panel.minimap')].filter(Boolean).join(' · ') || t('common.off')}
            min="confirme"
            paths={['overlay.profile', 'overlay.minimap']}
          >
            {/* a track without elevations has no profile to draw */}
            {(hasEle || !track) && (
            <WidgetGroup
              label={t('overlay.panel.profile')}
              enabled={overlay.profile.enabled}
              onToggle={(enabled) => setWidget('profile', { enabled })}
              position="profile"
              styled="profile"
              style={
                <>
                  {/* in its place of a style's structure the profile takes the whole width there: only its height counts */}
                  <RangeField
                    label={t('overlay.panel.profileWidth')}
                    min={PROFILE_WIDTH_MIN}
                    max={PROFILE_WIDTH_MAX}
                    step={0.01}
                    value={overlay.profile.width}
                    defaultValue={DEFAULT_SETTINGS.overlay.profile.width}
                    format={percent}
                    disabled={inStyleSlot(overlay, 'profile')}
                    onChange={(width) => setWidget('profile', { width })}
                  />
                  {inStyleSlot(overlay, 'profile') && <p className="type-hint">{t('overlay.panel.profileWidthInStyle')}</p>}
                  <RangeField
                    label={t('overlay.panel.profileHeight')}
                    min={PROFILE_HEIGHT_MIN}
                    max={PROFILE_HEIGHT_MAX}
                    step={0.01}
                    value={overlay.profile.height}
                    defaultValue={DEFAULT_SETTINGS.overlay.profile.height}
                    format={percent}
                    onChange={(height) => setWidget('profile', { height })}
                  />
                  <DotColor value={overlay.profile.markerColor} onChange={(markerColor) => setWidget('profile', { markerColor })} />
                </>
              }
            >
            </WidgetGroup>
            )}

            <WidgetGroup
              label={t('overlay.panel.minimap')}
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
              <p className="type-hint">{t('overlay.panel.minimapHint')}</p>
              {/* « Tableau » draws its mini-map in a disc of its own, never with the arrow (overlay/structures.ts) */}
              {!(overlay.style === 'tableau' && inStyleSlot(overlay, 'minimap')) && (
                <Checkbox checked={overlay.minimap.northArrow} onChange={(on) => setWidget('minimap', { northArrow: on })}>
                  {t('overlay.panel.northArrow')}
                </Checkbox>
              )}
            </WidgetGroup>
          </PanelSection>

          <PanelSection
            title={t('overlay.panel.weatherLogoText')}
            summary={
              [overlay.weather.enabled && t('overlay.panel.weather'), overlay.logos.some((logo) => logo.enabled && logo.image !== '') && t('overlay.panel.logo'), overlay.text.enabled && t('overlay.panel.text')]
                .filter(Boolean)
                .join(' · ') || t('common.off')
            }
            min="confirme"
            paths={['overlay.weather', 'overlay.logos', 'overlay.text']}>
            <WidgetGroup
              label={t('overlay.panel.weather')}
              enabled={overlay.weather.enabled}
              onToggle={(enabled) => setWidget('weather', { enabled })}
              // nothing to place or size until the weather of the day is loaded
              position={hasWeather ? 'weather' : undefined}
              styled={hasWeather ? 'weather' : undefined}
              style={hasWeather ? <SizeField value={overlay.weather.size} onChange={(size) => setWidget('weather', { size })} /> : undefined}
            >
              <p className="type-hint">
                {hasWeather
                  ? t('overlay.panel.weatherReady')
                  : t('overlay.panel.weatherWaiting')}
              </p>
            </WidgetGroup>

            {overlay.logos.map((logo, i) => (
              <WidgetGroup
                key={i}
                label={i === 0 ? t('overlay.panel.logo') : t('overlay.panel.logoN', { n: i + 1 })}
                enabled={logo.enabled}
                onToggle={(enabled) => setLogo(i, { enabled })}
                position={logo.image ? 'logo' : undefined}
                positionIndex={i}
                style={
                  !logo.image ? undefined : (
                  <>
                    <SizeField value={logo.size} onChange={(size) => setLogo(i, { size })} />
                    <RangeField
                      label={t('overlay.panel.opacity')}
                      min={0}
                      max={1}
                      step={0.05}
                      value={logo.opacity}
                      defaultValue={1}
                      format={percent}
                      onChange={(opacity) => setLogo(i, { opacity })}
                    />
                  </>
                  )
                }
              >
                <div className="flex gap-2 *:min-w-0 *:flex-1">
                  <Button onClick={() => void chooseLogo(i)}>
                    {logo.image ? t('marker.image.change') : t('marker.image.choose')}
                  </Button>
                  {logo.image && (
                    <Button onClick={() => setLogo(i, { image: '' })}>
                      {t('marker.image.remove')}
                    </Button>
                  )}
                </div>
                {logoError === i && (
                  <p className="type-hint" role="alert">
                    {t('marker.image.error')}
                  </p>
                )}
                {i > 0 && (
                  <Button onClick={() => set({ logos: overlay.logos.filter((_, at) => at !== i) })}>
                    {t('overlay.panel.logoRemove')}
                  </Button>
                )}
              </WidgetGroup>
            ))}
            <Button
              disabled={overlay.logos.length >= LOGOS_MAX}
              title={overlay.logos.length >= LOGOS_MAX ? t('overlay.panel.logoMax', { max: LOGOS_MAX }) : undefined}
              onClick={() => set({ logos: [...overlay.logos, { ...DEFAULT_LOGO, enabled: true, anchor: 'top-left' }] })}
            >
              {t('overlay.panel.logoAdd')}
            </Button>

            <WidgetGroup
              label={t('overlay.panel.freeText')}
              enabled={overlay.text.enabled}
              onToggle={(enabled) => setWidget('text', { enabled })}
              position={overlay.text.text.trim() !== '' ? 'text' : undefined}
              styled={overlay.text.text.trim() !== '' ? 'text' : undefined}
              style={overlay.text.text.trim() !== '' ? <SizeField value={overlay.text.size} onChange={(size) => setWidget('text', { size })} /> : undefined}
            >
              <TextField label={t('overlay.panel.text')} value={overlay.text.text} placeholder={t('overlay.panel.textPlaceholder')} onChange={(text) => setWidget('text', { text })} />
              <p className="type-hint">{t('overlay.panel.freeTextHint')}</p>
            </WidgetGroup>
          </PanelSection>
        </>
      )}

      <PanelSection title={t('overlay.panel.credits')} summary={t(`overlay.panel.creditsMode.${overlay.credits.mode}`)} min="expert" paths={['overlay.credits']}>
        <fieldset className="field min-w-0">
          <legend className="type-label mb-1 flex items-center gap-1">
            {t('overlay.panel.creditsMode')}
            <InfoTip text={t('overlay.panel.creditsTip')} />
          </legend>
          <RadioGroup wrap aria-label={t('overlay.panel.creditsMode')} value={overlay.credits.mode} onChange={(mode) => setWidget('credits', { mode })}>
            {CREDITS_MODES.map((mode) => (
              <Radio key={mode} value={mode}>
                {t(`overlay.panel.creditsMode.${mode}`)}
              </Radio>
            ))}
          </RadioGroup>
          <p className="type-hint">{t('overlay.panel.creditsHint')}</p>
        </fieldset>
        {overlay.credits.mode !== 'end' && (
          <AnchorPicker
            label={t('overlay.position')}
            value={overlay.credits.position}
            allowed={CREDITS_POSITIONS}
            onChange={(position) => setWidget('credits', { position })}
          />
        )}
      </PanelSection>
    </>
  )
}
