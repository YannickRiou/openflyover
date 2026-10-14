/**
 * « Importer depuis Strava » : a dialog. First the connection with the user's own Strava application (Client ID and
 * Secret, src/strava/api.ts), then the list of their activities to import. Each opener (« + Ajouter » of the track
 * list, welcome card) has its own dialog, drawn in the page body so a hidden panel never hides it.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { errorMessage } from '../core/errors'
import { t as translate, useT } from '../i18n'
import { formatDate } from '../i18n/format'
import { tRich } from '../i18n/rich'
import { assignColors } from '../import'
import { getPlatform } from '../platform'
import { authorizeInBrowser } from '../platform/oauthRedirect'
import {
  ACTIVITIES_PER_PAGE,
  StravaAuthError,
  authorizeUrl,
  callbackDomain,
  connect,
  disconnect,
  fetchStreams,
  forgetApp,
  listActivities,
  loadApp,
  loadTokens,
  parseCallback,
  saveApp,
} from '../strava/api'
import type { StravaActivity } from '../strava/api'
import { stravaSportLabel, streamsToTrack } from '../strava/track'
import { useAppStore } from '../state/store'
import { formatAscent, formatDistance } from './format'
import { runImport } from './projectActions'
import { Button, Checkbox, Modal } from './primitives'

/** A column of the dialog, and a line of its buttons (the hint, if any, takes the room on the left). */
const BODY = 'flex flex-col gap-3'
const ACTIONS = 'flex items-center justify-end gap-2 [&>.type-hint]:mr-auto'
/** An activity: the tick, then its name over its details (HeroUI's label text is the last child of the checkbox's content). */
const ITEM =
  'flex w-full border-b border-edge px-1 py-2 [&_.checkbox__content]:min-w-0 [&_.checkbox__content]:flex-auto ' +
  '[&_.checkbox__content>:last-child]:grid [&_.checkbox__content>:last-child]:min-w-0 [&_.checkbox__content>:last-child]:flex-auto [&_.checkbox__content>:last-child]:gap-0.5'

/** « Importer depuis Strava » of the welcome card. */
export function StravaImport() {
  const t = useT()
  const loading = useAppStore((s) => s.loading)
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={loading}>
        {t('strava.import')}
      </Button>
      <StravaDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}

/** The Strava dialog, drawn in the page body (« + Ajouter » of the track list, welcome card). */
export function StravaDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useT()
  // the body is mounted while open only: every opening starts again from the stored connection
  return (
    <Modal open={open} onClose={onClose} title={t('strava.import')} closeLabel={t('common.close')} closeTip={t('common.closeEsc')}>
      <StravaBody onImported={onClose} />
    </Modal>
  )
}

function StravaBody({ onImported }: { onImported(): void }) {
  const [connected, setConnected] = useState(() => loadTokens() !== null)
  const [notice, setNotice] = useState<string | null>(null)
  const signedOut = useCallback((message: string | null) => {
    setNotice(message)
    setConnected(false)
  }, [])
  return connected ? (
    <ActivityPicker onSignedOut={signedOut} onImported={onImported} />
  ) : (
    <ConnectForm
      notice={notice}
      onConnected={() => {
        setNotice(null)
        setConnected(true)
      }}
    />
  )
}

/** « Connecter Strava » : how to create the Strava application, its Client ID and Secret, « Se connecter ». */
function ConnectForm({ notice, onConnected }: { notice: string | null; onConnected(): void }) {
  const t = useT()
  const id = useId()
  const [saved] = useState(loadApp)
  const [clientId, setClientId] = useState(saved?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState(saved?.clientSecret ?? '')
  const [hasSaved, setHasSaved] = useState(saved !== null)
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState(notice)
  const pending = useRef<AbortController | null>(null)
  const { capabilities } = getPlatform()

  // closing the dialog gives up a connection still waiting for Strava
  useEffect(() => () => pending.current?.abort(), [])

  function signIn() {
    const app = { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
    saveApp(app)
    setHasSaved(true)
    setError(null)
    setWaiting(true)
    const state = crypto.randomUUID()
    const controller = new AbortController()
    pending.current = controller
    // on the web this opens the popup: still inside the click
    authorizeInBrowser(capabilities, (redirectUri) => authorizeUrl(app.clientId, redirectUri, state), controller.signal)
      .then((params) => connect(app, parseCallback(params, state)))
      .then(onConnected, (err: unknown) => {
        if (!controller.signal.aborted) setError(errorMessage(err))
      })
      .finally(() => setWaiting(false))
  }

  function forget() {
    forgetApp()
    setClientId('')
    setClientSecret('')
    setHasSaved(false)
  }

  return (
    <form
      className={BODY}
      onSubmit={(e) => {
        e.preventDefault()
        signIn()
      }}
    >
      <ol className="flex list-decimal flex-col gap-1 pl-5">
        <li>
          {tRich('strava.step1', {
            link: <b>strava.com/settings/api</b>,
            domain: <code>{callbackDomain(location.hostname, capabilities.isDesktop)}</code>,
          })}
        </li>
        <li>{t('strava.step2')}</li>
        <li>{t(capabilities.isDesktop ? 'strava.step3Browser' : 'strava.step3Window')}</li>
        <li>{t('strava.step4')}</li>
      </ol>
      <div className="flex flex-col gap-1">
        <label className="type-label" htmlFor={`${id}-client`}>
          Client ID
        </label>
        <input id={`${id}-client`} className="input" inputMode="numeric" autoComplete="off" value={clientId} disabled={waiting} onChange={(e) => setClientId(e.currentTarget.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="type-label" htmlFor={`${id}-secret`}>
          Client Secret
        </label>
        <input id={`${id}-secret`} className="input" type="password" autoComplete="off" value={clientSecret} disabled={waiting} onChange={(e) => setClientSecret(e.currentTarget.value)} />
      </div>
      <p className="type-hint">{t('strava.privacy')}</p>
      <p className="type-hint">Powered by Strava</p>
      {error && (
        <p className="type-hint" role="alert">
          {error}
        </p>
      )}
      {waiting ? (
        <div className={ACTIONS}>
          <p className="type-hint">{t('strava.waiting')}</p>
          <Button onClick={() => pending.current?.abort()}>
            {t('common.cancel')}
          </Button>
        </div>
      ) : (
        <div className={ACTIONS}>
          {hasSaved && (
            <Button onClick={forget}>
              {t('strava.forget')}
            </Button>
          )}
          <Button variant="primary" type="submit" disabled={!clientId.trim() || !clientSecret.trim()}>
            {t('strava.connect')}
          </Button>
        </div>
      )}
    </form>
  )
}

/** The athlete's activities, 30 at a time (« Plus »), filtered by name; the ticked ones are imported. */
function ActivityPicker({ onSignedOut, onImported }: { onSignedOut(message: string | null): void; onImported(): void }) {
  const t = useT()
  const id = useId()
  const [athlete] = useState(() => loadTokens()?.athlete ?? '')
  // a new object loads its page again (« Réessayer » after an error)
  const [request, setRequest] = useState({ page: 1 })
  const [activities, setActivities] = useState<StravaActivity[]>([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())

  useEffect(() => {
    const controller = new AbortController()
    listActivities(request.page, controller.signal).then(
      (page) => {
        setActivities((list) => [...list, ...page])
        setMore(page.length === ACTIVITIES_PER_PAGE)
        setBusy(false)
      },
      (err: unknown) => {
        if (controller.signal.aborted) return
        if (err instanceof StravaAuthError) return onSignedOut(err.message)
        setError(errorMessage(err))
        setBusy(false)
      },
    )
    return () => controller.abort()
  }, [request, onSignedOut])

  const toggle = (activityId: number) =>
    setSelected((set) => {
      const next = new Set(set)
      if (!next.delete(activityId)) next.add(activityId)
      return next
    })

  /** « Plus », or « Réessayer » the page that failed */
  function loadNext() {
    setBusy(true)
    setError(null)
    setRequest({ page: error ? request.page : request.page + 1 })
  }

  function importSelected() {
    const chosen = activities.filter((a) => selected.has(a.id))
    onImported()
    void runImport(
      chosen.map((activity) => ({
        label: activity.name,
        run: async (colorIndex) => assignColors([streamsToTrack(activity, await fetchStreams(activity.id))], colorIndex),
      })),
    )
  }

  const needle = query.trim().toLowerCase()
  const shown = needle ? activities.filter((a) => a.name.toLowerCase().includes(needle)) : activities

  return (
    <div className={BODY}>
      <div className={ACTIONS}>
        <p className="type-hint">{athlete ? t('strava.connectedAs', { athlete }) : t('strava.connected')}</p>
        <Button
          size="sm"
          onClick={() => {
            disconnect()
            onSignedOut(null)
          }}
        >
          {t('strava.disconnect')}
        </Button>
      </div>
      <input
        className="input"
        type="search"
        aria-label={t('strava.searchAria')}
        placeholder={t('strava.search')}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      <ul className="max-h-[min(360px,45vh)] overflow-y-auto phone-any:max-h-none" aria-describedby={`${id}-status`}>
        {shown.map((activity) => (
          <li key={activity.id}>
            <Checkbox className={ITEM} checked={selected.has(activity.id)} onChange={() => toggle(activity.id)}>
              <span className="truncate font-semibold">{activity.name}</span>
              <span className="type-hint">
                {[
                  formatDate(new Date(activity.start_date_local), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
                  stravaSportLabel(activity),
                  formatDistance(activity.distance),
                  translate('format.ascent', { value: formatAscent(activity.total_elevation_gain) }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </Checkbox>
          </li>
        ))}
      </ul>
      <p id={`${id}-status`} className="type-hint">
        {busy ? t('strava.loading') : shown.length === 0 ? t('strava.none') : t('strava.shownToYou')}
        {' '}Powered by Strava
      </p>
      {error && (
        <p className="type-hint" role="alert">
          {error}
        </p>
      )}
      <div className={ACTIONS}>
        {(more || error) && (
          <Button onClick={loadNext} disabled={busy}>
            {error ? t('common.retry') : t('strava.more')}
          </Button>
        )}
        <Button variant="primary" onClick={importSelected} disabled={selected.size === 0}>
          {selected.size > 0 ? t('strava.importCount', { count: selected.size }) : t('strava.importButton')}
        </Button>
      </div>
    </div>
  )
}
