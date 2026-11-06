# Vision

What OpenFlyover is for, who it serves and how a change is judged. Read it before proposing a feature; the
[roadmap](ROADMAP.md) says what comes next.

## In one sentence

OpenFlyover turns the track of an outing into a 3D film worth sharing, beautiful by default, on a phone as on a
computer, without an account and without the files leaving the device.

## Two people, one engine

OpenFlyover is built first for its maintainer, who wants a complete tool where every part of the film can be set. It
must also let someone who knows nothing about cameras, skies or video codecs export a beautiful film with little effort.

Both use the same engine and the same project file. They differ only in what the interface shows:

- **Débutant** shows what a first film needs: import, the activity, the preview, the export.
- **Expert** shows every setting.
- **Confirmé** sits between the two.

A mode only hides; the film is the same in the three. A first visit opens in Débutant. The mode chosen afterwards is
kept on the device, so a person who always works in Expert chooses it once per device.

The phone and the computer have the same standing: the same path from import to film, the same quality of result. The
computer is allowed to take longer for longer or larger films.

## Promises

1. **Beautiful by default.** A film exported without opening « Réglages » is one the person is glad to share.
2. **Complete when wanted.** What can be set today stays reachable. Simplifying the interface never means removing what
   the Expert mode relies on without a decision recorded in the roadmap.
3. **An export that finishes.** Its length is announced before it starts, and an interruption does not lose the work
   already done.
4. **Projects that keep opening.** A project saved by a version opens in every later version.
5. **Local and open.** No account, no server-side code, no tracking. Files stay on the device; the app downloads only
   open map, terrain, weather and landmark data.

## What OpenFlyover is not

- Not a social network or a hosting service for films.
- Not a general video editor: the timeline serves the flyover, its texts, photos, videos and music.
- Not a training log or an activity analysis tool: the figures of the track serve the film.
- Not a service that needs an account, a key or a subscription.

## How a change is judged

A change is worth doing when it does at least one of these:

- shortens the path from importing a track to an exported film;
- makes the film more beautiful without a new setting;
- makes the export faster or safer;
- keeps a promise above that is not kept today.

Otherwise it goes to the « Not now » list of the roadmap, with the reason.

For each change, the pull request says which of these it serves and how it will be checked (a test, a measurement on
a reference project, a person trying it). A new setting comes with a default that suits most films, the rule that says
when it matters (when it does not, it is hidden, never reset), and a reset by double click when it is a slider.

Removing a feature is decided case by case, not by principle. Three questions guide it: does one of the two people
above use it, does it cost much to maintain, does another feature already do the same. The answer and the decision go
in the roadmap.
