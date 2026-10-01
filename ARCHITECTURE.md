# Architecture

## Layers and ownership

| Layer            | Path                                                             | Responsibility                                                                                 |
| ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contracts        | `src/contracts`, `src/config/limits.ts`, `src/game/contracts.ts` | Zod schemas and types shared by app, mocks and tests. The only place that defines data shapes. |
| Simulation       | `src/game/sim`, `src/config/gameplay.ts`                         | Pure game rules. No Pixi, DOM, wall clock or `Math.random`.                                    |
| Rendering / host | `src/game/render`, `src/game/host`, `src/game/input`             | Pixi scene, asset loading, fixed-step loop, input capture, `GameHost`.                         |
| Network          | `src/api`, `src/mocks`                                           | Axios client, TanStack Query hooks, outbox, MSW handlers, scenarios.                           |
| UI shell         | `src/ui`, `src/state`                                            | React screens, primitives, skin, player/options state.                                         |
| Validation       | `src/contracts`, `src/lib/storage.ts`                            | Every external input goes through a schema.                                                    |

Dependency direction: `ui -> api, game/host -> game/sim -> contracts`. The simulation never imports React or Pixi.

## Contracts

- **`MatchConfig`** = `{ sessionSeconds: 60..180, spawnIntervalMs: 500..10000 (step 100, default 3000) }`. Stored in ms to avoid float keys. Matches are only ranked against matches with the same config.
- **`MatchSubmission`** (POST body) carries `matchId`, `playerId`, `playerName`, `playedAt`, `score`, `durationMs`, `endReason`, `config`, `seed`. `matchId` is generated client-side at match end and makes the submission idempotent. It contains what a real server would need to replay the match.
- **Ranking order** (`compareRanking`): score desc, duration asc, `playedAt` asc, `matchId` asc.
- **Idempotency**: `POST /api/matches` returns 201 when created and 200 with `duplicate: true` when the `matchId` exists; the same `matchId` with a different payload is a 409.
- **Outbox**: a finished match is persisted locally before the first send and stays there until confirmed. Status: `pending -> syncing -> synced | failed`. It never blocks playing another match.
- **Fixed step**: `FIXED_STEP_MS = 1000/60`; the loop accumulates real time and runs whole steps, so movement, damage and spawns are independent of the frame rate.
- **Arena**: logical 1600x900 units; the renderer scales, the simulation never sees pixels.
- **React sync**: React only receives `HudState`, emitted on change (never per frame).

## Threat model and anti-cheat

The game is client-side by requirement, so everything the browser holds is controlled by the player:
memory editors, DevTools, extensions, forged requests and edited `localStorage` can all change what is
sent. The goal is therefore twofold: keep untrusted input from breaking the app (built), and shape the
data so a real backend could stop fake scores (the contract is ready; the backend is out of scope).

### What an attacker can try, and what this project does

| Attack                                                            | In this project                                                                                                                                                          | Residual risk                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Inject markup or script through the player name                   | Allowlist regex (letters, digits, space, `_`, `-`; 1-16 characters), React escapes text, no `dangerouslySetInnerHTML` or `eval` (lint rules)                             | None known                                                       |
| Malformed or oversized payloads, unknown keys, `__proto__` tricks | Strict Zod schemas at every boundary: options, query strings, `localStorage` reads, request bodies and responses; hostile inputs are unit tested                         | None known                                                       |
| Edit `localStorage` (options, outbox, last result, mock database) | Every read is validated and falls back to defaults; the outbox is capped at 100 entries and the mock database at 500 records                                             | A well-formed edit is accepted, but it only affects that browser |
| Submit an impossible score or duration                            | The API checks score <= floor(duration / spawn interval), duration <= session length (+1 s tolerance), `time_up` only near the full session length, id/date/seed formats | A plausible score still passes                                   |
| Replay or double-submit a match                                   | `matchId` is idempotent: same payload returns the existing record (200), a different payload with the same id is rejected (409); fixture ids are reserved                | None for duplicates                                              |
| Forge a plausible score, or edit the simulation in memory         | Cannot be prevented in the client                                                                                                                                        | See hardening below                                              |
| Use the test hook as a cheat API                                  | `window.__game` exists only in builds made with `VITE_E2E=true`; the public build does not expose it                                                                     | Anyone can still use DevTools                                    |
| Bots and automation                                               | Not addressed                                                                                                                                                            | Needs server-side rate limits and behaviour checks               |

### Production hardening (designed for, not built)

1. **Server-issued match sessions.** When a match starts the server returns a signed, single-use,
   short-lived token holding `matchId`, `seed` and `config`. The client no longer chooses its own seed or
   id, and every submission must carry a valid token.
2. **Server-side replay.** The client also sends the input log (the held buttons per fixed step, run-length
   encoded). The server runs the same simulation (`src/game/sim` is pure TypeScript with no DOM, so it runs
   on Node unchanged), recomputes score, duration and end reason, and rejects a mismatch. The score becomes
   authoritative instead of reported. A three-minute match simulates in tens of milliseconds, so this is cheap.
3. **Wall-clock checks.** The time between issuing the token and receiving the submission must be at least the
   match duration and not absurdly longer, so a three-minute match cannot arrive five seconds after it started.
4. **Rate limits and anomaly detection.** Limits per player and per IP, outlier scores, inhuman input rates
   (more changes per second than a hand can make) and perfect accuracy are flagged for review.
5. **Real identity.** Accounts instead of a client-chosen name and `playerId`, with the name sanitised again on
   the server; ranking moderation and an audit log to remove entries.
6. **Transport and page hardening.** HTTPS only, a Content-Security-Policy and the usual headers
   (`X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors`), so injected scripts cannot run or exfiltrate.

### Why the project is ready for it

- The simulation is deterministic: fixed time step, seeded random numbers, no wall clock, and the same seed
  plus the same inputs always give the same match (covered by tests). That is what makes replay validation
  possible at all.
- Every record already carries `seed`, `config` and `durationMs`, and the contract is shared by the app, the
  mock API and the tests, so adding `token` and `inputLog` is an additive change.
- The mock handlers already live behind a typed REST contract; moving them to a real service changes where
  they run, not the shape of the data.

### What client-side hardening can and cannot do

Obfuscation, anti-debugging or hiding globals only slow down a determined cheater; they do not stop one,
and they make the code harder to review. This project deliberately spends its effort where it matters:
validating everything it receives, not trusting the client, and keeping the simulation replayable so the
server can be the authority. Preventing a player from forging a plausible score needs that server.

## Simulation (`src/game/sim`)

Pure rules, no Pixi/DOM/clock/`Math.random`. `createSimulation(settings)` returns a `Simulation`
(`step`, `snapshot`, `drainEvents`, `result`).

- **Time.** `step(input)` always advances exactly `FIXED_STEP_MS` (1000/60). Cooldowns and spawn ticks
  are converted to whole steps, so movement, damage and spawns do not depend on the frame rate.
- **Determinism.** Every random choice comes from a seeded mulberry32 stream. Same seed + same input
  sequence gives identical snapshots (covered by a hash-over-thousands-of-steps test).
- **Step order.** player -> enemies -> projectiles (swept collisions) -> chaser impacts -> end check ->
  weapon fire -> spawn tick. After the end, `step` is a no-op and exactly one `match_end` event exists.
- **Coordinates.** Arena is 1600x900 world units, y down. Angle 0 points east and rotation is clockwise
  on screen.
- **Collisions.** Ships, projectiles and islands are circles. Ships are pushed out of islands and the
  arena border (sliding, never tunnelling). Projectiles use segment-vs-circle sweeps so a fast shell
  cannot skip a target. Each projectile applies damage once and is removed on hit, island, expiry or
  leaving the arena. Destroyed enemies are removed immediately and stop firing and colliding.
- **Spawning.** One enemy per tick, first tick at `t = spawnIntervalMs`, so `score <= floor(duration /
spawnIntervalMs)` always holds (the mock API validates this). Spawn points are free of islands and
  at least a configured distance from the player, with a deterministic fallback. A bag with 3 chasers
  and 2 shooters guarantees both kinds appear.
- **Rules.** +1 point per enemy destroyed by player projectiles; a chaser exploding on the player does
  not score. If death and time-up land on the same step, `player_destroyed` wins.
- **Balance.** Every number lives in `src/config/gameplay.ts` (`GameplayConfig`, `DEFAULT_GAMEPLAY`).
  Systems contain no magic numbers, so balance changes never touch the rules.

## React / Pixi integration (`src/game/host`, `src/game/render`)

- React only knows the `GameHost` interface: `mount / start / pause / resume / restart / setInput /
subscribe / onEnd / destroy`. It never sees frames.
- **Loop.** `PixiGameHost` accumulates real frame time (capped at 250 ms per frame), runs whole fixed
  steps, then draws once. Rendering reads a snapshot; the scene never mutates game state.
- **React sync.** `HudState` (phase, score, time, health) is emitted only when it changes; the clock is
  quantised to 100 ms, so React re-renders at most about ten times per second and never per frame.
- **Pause.** Pausing stops stepping and clears held input. Resuming requires an explicit call and
  discards input from the pause, so nothing accumulates. Ending a match keeps animating for 1.3 s
  (sinking, explosions) before `onEnd` fires.
- **Canvas.** The world container is scaled to fit the container at 16:9 (letterboxed) and re-laid out
  by a `ResizeObserver`; the renderer resolution follows `devicePixelRatio` (capped at 2) and reacts to
  DPR changes (zoom, moving between monitors). Input coordinates never depend on canvas pixels.
- **Assets.** `loadGameAssets` loads every texture once with progress, treats each failure separately and
  rejects with `AssetLoadError`; calling it again retries only what is missing. Textures are shared
  across matches through the Pixi cache, so restarting does not reload or leak them.
- **Effects.** Muzzle flashes, impacts, explosions, debris and sinking wrecks are pooled sprites driven
  by the simulated clock. Ship sprites change with health (intact, torn sails, heavy damage, wreck),
  with fire on heavy damage and a red flash on hit. Screen shake honours `prefers-reduced-motion`.
- **Audio.** `AudioEngine` (Web Audio) maps simulation events to sounds. It is best effort: no device,
  blocked autoplay or failed download never throws. Mute is persisted.

## Input: keyboard, buttons and stick

The simulation only understands six held booleans (`InputState`). There are two movement schemes, one per
kind of device, and they can be used together:

- **Keyboard (tank style).** W (forward), A / D (rotate) and the arrow keys (Up = front cannon, Left / Right =
  broadsides) are bound in `KEY_BINDINGS` (`src/game/controls.ts`) and set the booleans through
  `host.setInput`. The same table feeds the in-game help.
- **Touch (heading based).** The steering stick calls `host.setSteer` with a screen direction and a push from
  0 to 1. On every fixed step the host turns that, together with the ship's current heading, into forward /
  turn-left / turn-right (`src/game/steering.ts`, pure and unit tested) and ORs it with the held booleans.
  The angle of a screen vector (`atan2(dy, dx)`, y down) is the simulation's own convention, so nothing needs
  converting. Below a dead zone (20 %) the stick does nothing, from 30 % it sails, and a reversal of more than
  ~108 degrees turns in place first. The touch weapon buttons use `host.setInput` like the arrow keys.

The simulation itself is unchanged by either. Held keys and steering are dropped on pause, resume, end of
match and unmount.

## Assets and third-party resources

- **Challenge assets** (`assets/`) are served as they are (copied to the build by `vite-plugin-static-copy`)
  and loaded through the manifest in `src/game/assets` (game textures) and `src/ui/skin.ts` (UI sprites).
- **Kenney "Mobile Controls" (CC0 1.0)** is the one complementary graphic resource. Reason: the provided UI kit
  has no analog stick or pressed-state rings, and the touch scheme (a heading-based stick plus weapon buttons,
  see Input below) needs them to feel right on a phone. Only the used PNGs are bundled, unmodified, in
  `public/vendor/kenney-mobile-controls/` with the pack's `License.txt`. They are referenced from CSS
  (`src/index.css`, `.touch-*`), so there is no runtime dependency or code from the pack; the controls are
  drawn at 70% opacity (40% while held) over the arena. The wooden theme of the challenge assets stays on
  menus and HUD; the touch layer is deliberately neutral so it does not compete with the game.
- **Fonts** are self-hosted through `@fontsource` (SIL OFL 1.1); the speaker and fullscreen glyphs are inline SVG.

All sources and licenses are in `THIRD_PARTY_LICENSES.md`.

## Resource lifecycle

`destroy()` is idempotent and releases the ticker callback, `ResizeObserver`, DPR listener, scene
graph, effects, health-bar sub-textures, audio loops, the test hook and the Pixi application (with its
canvas). Textures stay in the shared cache on purpose. A `destroy()` that arrives while `mount()` is
still awaiting (React Strict Mode) is detected after each await, so no orphan canvas is left behind.

## E2E instrumentation

Builds made with `VITE_E2E=true` expose `window.__game` (`getSnapshot`, `getHud`, `setClockMode`,
`advance`, `setSeed`) and honour `?clock=manual&seed=N`. The rules, collisions and rendering still run
for real; the hook only observes state and drives the clock. `?perf=1` (or the E2E build) enables the
frame-time sampler behind `window.__perf`.

With the manual clock, `advance()` never draws synchronously: it queues one `requestAnimationFrame` draw, so a test
that advances thousands of times costs one frame per display frame rather than one per call. This is what
keeps the suite fast on software WebGL (CI runners without a GPU): the full E2E run takes about 2 minutes
locally and about 5 minutes on GitHub Actions.

## Local persistence

Everything persisted lives in `localStorage` under one namespace (`STORAGE_KEYS` in `src/lib/storage.ts`)
and every read goes through `readStorage(key, schema, fallback)`: missing, unparsable, tampered or
throwing storage all resolve to the fallback, so a hostile or corrupted value can never crash the app.

| Key                           | Content                                                                          | Schema                     |
| ----------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| `pirate-battle:options`       | Session time and spawn interval                                                  | `matchConfigSchema`        |
| `pirate-battle:player`        | `playerId` and display name                                                      | player schema (name regex) |
| `pirate-battle:last-result`   | Last completed match (a full `MatchSubmission`)                                  | `matchSubmissionSchema`    |
| `pirate-battle:outbox`        | Matches waiting for the server (max 100)                                         | `pendingOutboxSchema`      |
| `pirate-battle:outbox-synced` | Recently confirmed records, so a finished match keeps its status after a refresh | outbox schema              |
| `pirate-battle:mock-db`       | Confirmed records of the mocked API (max 500)                                    | mock DB schema             |
| `pirate-battle:mock-scenario` | Selected network scenario                                                        | `scenarioIdSchema`         |
| `pirate-battle:muted`         | Sound preference                                                                 | boolean                    |

Reloading the page or leaving a match abandons it: nothing is written for a match that did not finish.

## Ranking and history integration

- **Contracts** (`src/contracts/api.ts`): typed paths, query and body schemas; the client parses every
  response with the same schemas, so an invalid payload becomes a typed `ApiError` (kinds `network`,
  `timeout`, `http`, `invalid_response`) and never reaches the UI.
- **Axios** (`src/api/client.ts`): one instance, a configurable timeout (default 8 s, `?timeoutMs=`),
  cancellation through the `AbortSignal` that TanStack Query provides.
- **Queries** (`src/api/queries.ts`, `hooks.ts`): keys carry every parameter (config, page, page size,
  player), so answers for different pages never share a cache entry. Retries use exponential backoff
  (0.5 s doubling, capped at 5 s, 2 attempts) only for transient failures (network, timeout, 5xx, 408,
  425, 429). `staleTime` is 5 s and queries refetch on mount, window focus and reconnect, so Ranking and
  Match History are fresh whenever they are shown again. `placeholderData` keeps the previous page on
  screen while the next one loads (with a non-blocking "Updating" indicator).
- **Stale answers.** Requests are cancelled when their key is no longer observed, and a response can only
  write to the cache entry of the key that asked for it, so a slow answer for page 2 cannot overwrite
  page 5. Covered by the `out_of_order` and `variable_latency` scenarios in unit and E2E tests.
- **After a match is confirmed** the outbox invalidates the ranking and history queries. It cancels
  in-flight requests first: without that, TanStack Query would reuse an in-flight fetch that started
  before the confirmation and hand back a snapshot without the new record.
- **Ranking** compares only matches with the same `MatchConfig` (the UI passes the current options);
  order is `compareRanking`: score desc, duration asc, `playedAt` asc, `matchId` asc, and `rank` is
  computed over the whole filtered list, not the page.

## Pending-record recovery (outbox)

1. When a match ends the app builds a `MatchSubmission` (`matchId` from `crypto.randomUUID()`), stores it as
   the last result and calls `enqueueMatch`. The entry is **persisted before the first send**.
2. Sending is single-flight per `matchId` and always reuses that same id. `POST /api/matches` is idempotent:
   201 for a new record, 200 with `duplicate: true` when it already exists (both mean success), 409 when the
   id exists with a different payload.
3. Failures keep the entry queued. Timeouts, connection errors, 5xx, 408, 425 and 429 retry automatically
   after 2 s, 5 s, 15 s and 30 s; after that the entry waits for a manual Retry, the `online` event or
   the next app start (`flushPending`). 4xx errors (including 409) are never retried automatically.
4. Status exposed to the UI: `pending -> syncing -> synced | failed`, observed through
   `useSyncExternalStore`; the Result screen and the menu's "Last match" card show it with a Retry button.
5. A pending record never blocks playing again, and several can be queued at once. After a refresh the
   persisted outbox is flushed on start.
6. **Timeout after commit** (`submit_timeout_after_commit`): the mock stores the record and then does not
   answer in time; the retry finds the id, answers `duplicate: true`, and exactly one record exists.

## MSW mock layer

Handlers, fixtures and the persisted database are shared by the browser worker (development, tests and the
published build) and by `msw/node` in unit tests. The worker script is served as a static file
(`/mockServiceWorker.js`), unhandled requests (`/assets/**`, fonts, the app) bypass it, and starting
mocks can never block the app (`enableMocking` races a short timeout and never rejects).

- **Fixtures** are generated from a fixed seed: 27 ranking entries for the default config (several pages)
  and smaller sets for four other configs. `many_pages` adds 137 entries per config and a synthetic
  35-record history. Every fixture obeys the plausibility rules of the API.
- **Server-side checks** on POST: schema validation with strict objects, duration versus session length,
  plausible score for the spawn interval (`maxPlausibleScore`), reserved `fx-` ids, a cap of 500 stored
  records.
- **Scenarios** (14, see the README table) are selected from the UI panel or `?scenario=`; latency,
  variable-latency seed, client timeout and retries are controllable from the URL so tests are
  reproducible.
- **Reset** clears the mock database, the scenario, the outbox and the query cache. Options and the last
  result are kept.

## Balance decisions

All numbers are in `src/config/gameplay.ts`. Defaults: player 100 HP, 220 px/s, 2.3 rad/s; front cannon
20 damage every 350 ms; each broadside is 3 parallel shells every 1400 ms; Chaser 40 HP, 150 px/s, 25
contact damage; Shooter 60 HP, 95 px/s, fires from 520 px (holds around 340 px) every 1800 ms for 10
damage; at most 10 enemies alive; spawn points at least 480 px from the player; five islands leaving
corridors of at least ~300 px. The spawn bag holds 3 Chasers and 2 Shooters, so both kinds show up within
any five spawns. An idle player is sunk in roughly 16-22 s; a simple auto-aim bot scores 27-28 points in a
90 s match with a 3 s interval.

## Known limitations

- **Trust.** The game is client-side by requirement; scores can be forged (see the threat model).
- **Score ceiling.** The mock API caps a match at `floor(duration / spawnInterval)` points and the first
  spawn happens after one interval, so 90 s / 3 s allows at most 29 (28-29 is what a good bot reaches).
  Shorter spawn intervals raise the ceiling.
- **Rendering.** Hardware acceleration is required for 60 FPS. With software WebGL the game runs at about
  20 FPS (correctly, but with dropped frames); see [docs/PERFORMANCE.md](docs/PERFORMANCE.md).
- **Mobile.** Landscape only. Touch controls are covered by synthetic pointer events and a 4x
  CPU-throttled emulation, and were also tried by hand on real phones. Fullscreen and the landscape lock
  exist only where the browser offers them (Chrome on Android). iPhone Safari offers neither to web pages,
  so the UI shows tips instead (Add to Home Screen via the web manifest, Portrait Orientation Lock); the
  rotation itself cannot be forced there.
- **Visual baselines** were generated on Windows with the bundled Chromium; CI on Linux skips the pixel
  comparison because fonts render differently.
- **Enemy pathing** avoids islands with a single-blocking-island look-ahead heuristic; a Chaser can graze an
  island but never crosses it.
- **Scenario state** is per browser tab until reload (a scenario change in one tab is not pushed to
  another), and the outbox keeps at most 100 entries (oldest dropped).
- **Console.** Chromium itself logs failed HTTP responses (503 in the outage scenarios) as console errors;
  the app throws no unhandled errors in the planned flows.
