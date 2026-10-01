# Pirate Battle

A 2D top-down naval shooter built with **React**, **TypeScript (strict)** and **PixiJS**. Sail between
islands, sink Chasers and Shooters, and climb a ranking that is served by a fully mocked REST API
(**MSW** + **Axios** + **TanStack Query**).

- **Live demo:** https://game-developer-challenge-pj2i.vercel.app (Vercel; the ranking and history run on MSW in the browser)
- **Architecture notes:** [ARCHITECTURE.md](ARCHITECTURE.md)
- **Performance report:** [docs/PERFORMANCE.md](docs/PERFORMANCE.md)
- **Development plan / status:** [PLAN.md](PLAN.md)
- **Third-party licenses:** [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)

The game is single-player and runs entirely in the browser. Gameplay and settings are local; the
ranking and the match history are REST endpoints simulated by MSW in the network layer (also in the
published build).

## Stack

| Responsibility                    | Technology                                  |
| --------------------------------- | ------------------------------------------- |
| UI and menus                      | React 19, Tailwind CSS 4                    |
| Language                          | TypeScript, strict mode                     |
| Game rendering                    | PixiJS 8                                    |
| Remote state (ranking, history)   | TanStack Query 5                            |
| HTTP client                       | Axios                                       |
| API mocking                       | MSW (service worker, works in the build)    |
| Validation of every external input | Zod                                        |
| UI state                          | Zustand                                     |
| Unit tests                        | Vitest                                      |
| E2E and visual regression         | Playwright (Chromium, desktop + mobile)     |
| Error monitoring                  | Sentry (opt-in through an environment variable) |
| Build / package manager           | Vite 8 / pnpm 10                            |

## Setup

Requirements: Node 22+ (developed on 24) and pnpm 10.

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. The first visit asks for a captain name (letters, digits, spaces, `_`, `-`,
up to 16 characters; closing the dialog uses "Captain").

### Commands

| Command                | What it does                                                       |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm dev`             | Development server                                                 |
| `pnpm build`           | Type-check and production build into `dist/`                       |
| `pnpm preview`         | Serve the production build locally                                 |
| `pnpm lint`            | oxlint (includes rules banning `eval` and `dangerouslySetInnerHTML`) |
| `pnpm typecheck`       | `tsc -b`                                                           |
| `pnpm format`          | Prettier                                                           |
| `pnpm test`            | Vitest unit tests (simulation, contracts, network, outbox, UI logic) |
| `pnpm e2e`             | Playwright: builds an e2e bundle, serves it and runs all specs     |
| `pnpm profile`         | Performance and memory profiling (see docs/PERFORMANCE.md)         |

Playwright details:

```bash
pnpm exec playwright install chromium   # once
pnpm e2e                                # desktop + mobile projects, HTML report in playwright-report/
pnpm exec playwright show-report        # open the report; traces of failures are kept in test-results/
pnpm exec playwright test --update-snapshots   # regenerate visual baselines (e2e/__screenshots__)
E2E_PORT=4174 pnpm e2e                  # use another port (parallel runs)
E2E_GPU=1 pnpm e2e                      # run with installed Google Chrome on the real GPU (lighter on the CPU)
E2E_WORKERS=1 pnpm e2e                  # fewer parallel browsers
```

Visual baselines (`e2e/__screenshots__`) were generated on Windows with the bundled Chromium (software
rendering) and are compared in local runs; CI skips the pixel comparison because fonts render differently
on Linux (set `E2E_VISUAL=1` to force it).

The E2E bundle is built with `--mode e2e` (see `.env.e2e`), which exposes the `window.__game` test hook
(state observation and a controllable simulation clock). The public build never exposes it.

### Environment variables

Copy `.env.example` to `.env` if you need any of them; all are optional.

| Variable          | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `VITE_SENTRY_DSN` | Enables Sentry error reporting. Empty (default) disables it completely. |
| `VITE_APP_VERSION`| Release label sent to Sentry.                                           |
| `VITE_E2E`        | `true` enables `window.__game`. Only used by the e2e build; never set it for a public deploy. |

## Controls

| Action                         | Keyboard      | Touch                    |
| ------------------------------ | ------------- | ------------------------ |
| Sail forward                   | `W`           | Push the stick           |
| Turn left / right              | `A` / `D`     | Point the stick to steer |
| Fire front cannon (1 shot)     | `Up` arrow    | Crosshair button         |
| Fire left broadside (3 shots)  | `Left` arrow  | Left flame button        |
| Fire right broadside (3 shots) | `Right` arrow | Right flame button       |
| Pause                          | `P` / `Esc`   | Pause button             |

On the keyboard movement is tank style: `W` sails forward and `A` / `D` rotate the ship. On touch screens
the left thumb uses a **steering stick** instead: the ship turns to the direction you point and sails while
the stick is pushed (a light touch in the centre only steers), and the right thumb uses the weapon buttons.
Movement and firing work at the same time: one hand on `WASD` keys and one on the arrows, or one thumb on
the stick and one on the weapon buttons. The touch controls are semi-transparent so the arena stays
readable (and even more so while held, so the thumb does not hide the sea), multi-touch capable, and appear on touch devices (or with `?touch=1`). Keys are captured only
while a match is on screen and no dialog is open. On phones use **landscape**; in portrait a rotate prompt is
shown and the match pauses.

Tapping **Play** on a phone also asks the browser for fullscreen and a landscape lock where it supports them
(Chrome on Android does; iPhone Safari does not). There is a fullscreen button next to the sound button in the
menu, and opening the page upright shows a "rotate your device" notice where tapping anywhere (or the
**Switch to landscape** button) forces landscape, because browsers only allow that after a tap. On touch
screens the HUD is smaller and see-through, so it covers less of the arena.

The match also pauses automatically when the window loses focus or the tab is hidden; resuming needs an
explicit click on **Resume** and never applies input held during the pause.

## Gameplay

- **Goal:** each enemy sunk by your shots is 1 point. A Chaser exploding on your ship scores nothing.
- **Match end:** time is up or your ship is destroyed. Reloading the page or leaving the match abandons
  it, and an abandoned match is never registered.
- **Enemies:** the **Chaser** rams you and explodes; the **Shooter** closes in and fires from range.
  Both respect islands.
- **Options screen:** `Game session time` 60-180 s (default 90) and `Enemy spawn time` 0.5-10 s in
  0.1 s steps (default 3 s). Values are validated, saved and persist after a refresh. Every match uses
  a snapshot of the settings taken when it starts. Ranking positions compare only matches with the same
  pair of settings.

### Gameplay configuration

All balance numbers live in a typed config: [src/config/gameplay.ts](src/config/gameplay.ts)
(`GameplayConfig`, `DEFAULT_GAMEPLAY`): health, speeds, turn rates, damage, projectile speed/range,
cooldowns, Shooter attack range, spawn distribution and cap, island layout. Changing the balance never
requires touching the systems. Player-tunable limits (session time, spawn interval, name, page size) are
in [src/config/limits.ts](src/config/limits.ts).

## Network scenarios (MSW)

The ranking and history APIs are simulated in the browser service worker, also in the published build:

```
GET  /api/ranking?sessionSeconds&spawnIntervalMs&page&pageSize
GET  /api/players/:playerId/matches?page&pageSize
POST /api/matches      (idempotent by matchId: 201 created, 200 duplicate, 409 conflicting payload)
```

Confirmed records are stored in `localStorage`, so they survive a refresh, and appear in both tabs.
Finished matches are queued in a persistent outbox first and are retried automatically (2 s, 5 s, 15 s,
30 s) or manually until the server confirms them; a pending record never blocks playing again.

### Selecting and resetting scenarios

- **From the UI:** the **Network scenarios** panel (menu footer and Options) lists every scenario and has
  a **Reset mocks** button that restores the initial state (default scenario, fixtures only, no player
  records, empty outbox). Options and the last result are never touched.
- **From the URL:** `?scenario=<id>` applies to that page load.
- **Reproducibility controls (URL):** `latencyMs=0..5000` fixed latency, `mockSeed=<uint32>` seed of the
  variable latency, `timeoutMs=50..30000` client timeout, `retry=0..3` GET retries.

| Scenario id                    | What happens                                                           |
| ------------------------------ | ---------------------------------------------------------------------- |
| `success`                      | Healthy API with fixtures (default)                                    |
| `empty`                        | Ranking and history are empty                                          |
| `many_pages`                   | Many fixtures, several pages                                           |
| `slow`                         | Fixed high latency                                                     |
| `variable_latency`             | Seeded, varying latency                                                |
| `out_of_order`                 | Earlier requests answer after later ones                               |
| `timeout`                      | Requests never answer within the client timeout                        |
| `network_error`                | Connection failures                                                    |
| `http_4xx` / `http_5xx`        | HTTP errors on all endpoints                                           |
| `ranking_fails`                | Only the ranking query fails                                           |
| `history_fails`                | Only the history query fails                                           |
| `submit_timeout_after_commit`  | POST commits then times out; the retry must not duplicate the record   |
| `submit_outage`                | POST unavailable until you change scenario or reset                    |

### Reproducing failures

1. **Outage at match end, then recovery:** open the scenario panel, choose `submit_outage`, play a
   match. The result screen shows the record as failed/pending. Reload the page (the entry is still in
   the outbox), switch to `success` and press **Retry** (or wait for the automatic retry): the match is
   registered once.
2. **Timeout after commit:** open `/?scenario=submit_timeout_after_commit&timeoutMs=500`, finish a match,
   then Retry. History and ranking contain exactly one entry for it.
3. **Query failures:** `ranking_fails`, `history_fails`, `http_5xx` show an accessible error with Retry;
   switch back to `success` and press Retry.
4. **Stale responses:** `out_of_order` and `variable_latency` while paging quickly: the table always ends
   up on the last selected page.

## Assets and credits

- **Provided by the challenge** (`assets/`): ships, tiles, effects, sounds, the menu and HUD UI kit and the
  reference screens. They are the visual base of the game and of every menu.
- **Complementary resource: Kenney "Mobile Controls" (CC0).** The provided UI kit has round buttons and arrow
  icons but no analog stick and no pressed-state rings, which a phone needs. After playing on a real phone the
  touch layout became a steering stick (one thumb steers) plus weapon buttons, and Kenney's CC0 pack
  ([kenney.nl/assets/mobile-controls](https://kenney.nl/assets/mobile-controls)) fills that gap: stick pad and
  knob, circle and direction buttons, held-state rings, crosshair and flame icons. The challenge allows
  complementary resources when sources and licenses are included; only the files used are bundled (in
  `public/vendor/kenney-mobile-controls/`, with the pack's own `License.txt`) and they are drawn
  semi-transparent so the arena stays readable.
- **Fonts:** Fredoka and Nunito Sans (SIL OFL 1.1), self-hosted. The speaker and fullscreen glyphs are original
  inline SVG.

Sources, licenses and bundled files are listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Project layout

```
src/contracts   Zod schemas and types shared by app, mocks and tests
src/config      Gameplay tuning and limits
src/game/sim    Pure game rules (deterministic, fixed step)
src/game/host   Pixi host: canvas, loop, resize, test hook
src/game/render Pixi scene and effects
src/game/audio  Web Audio engine
src/api         Axios client, TanStack Query hooks, outbox
src/mocks       MSW handlers, fixtures, scenarios
src/ui, state   React screens, design system, Zustand stores
e2e/            Playwright specs and visual baselines
docs/           Performance report and raw results
```

## Security and anti-cheat

The game is client-side by requirement, so the client is untrusted: DevTools, memory editors and forged
requests can change what is sent. What the project does about it:

- **Validation everywhere.** Every external input (player name, options, query strings, `localStorage`,
  request bodies and responses) goes through a strict Zod schema. The name is an allowlist (letters, digits,
  space, `_`, `-`), so markup cannot get in; there is no `eval` or `dangerouslySetInnerHTML` (lint rules).
- **Server-style checks in the mock API.** A submitted match must have a plausible score for its duration and
  spawn interval, a duration within the session length, valid ids and dates, and an idempotent `matchId`
  (same payload returns the existing record, a conflicting one is rejected).
- **No test hooks in production.** `window.__game` exists only in the E2E build.
- **Built to be verified by a server.** The simulation is deterministic (fixed step, seeded random numbers) and
  each record carries its `seed`, `config` and `duration`, so a real backend could replay a match and compute
  the score itself.

What it cannot do from the client is stop a player from submitting a *plausible* fake score. The plan for a
real deployment (server-issued session tokens, replay of the input log on the server, wall-clock checks, rate
limits, real identity and security headers) is described in the **Threat model and anti-cheat** section of
[ARCHITECTURE.md](ARCHITECTURE.md), together with an attack-by-attack table of what is and is not covered.

## Deployment

The main menu shows a small **Build** label with the short commit of the running version, so you can always
tell which build you are looking at (useful after a deploy: reload the page if the label is an old commit).

Static build (`pnpm build` -> `dist/`). `vercel.json` rewrites unknown paths to `index.html` and serves
`/mockServiceWorker.js` as a static file. Reloading any URL works. Deploying to Netlify or Cloudflare
Pages needs the same SPA fallback.
