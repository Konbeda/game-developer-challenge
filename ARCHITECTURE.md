# Architecture

> Work in progress. Sections are filled as each area lands; the contract sections below are already binding.

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

## Threat model

The game is client-side by requirement, so the client is untrusted: memory editors, DevTools, request forging and `localStorage` edits can all alter scores. Mitigations that fit this scope:

- Every external input is validated by a Zod schema: player name (allowlist regex), options, query strings, `localStorage` reads (`readStorage`), MSW request bodies and API responses. Strict objects reject unknown keys, including `__proto__`.
- The MSW handlers apply server-style sanity checks (duration vs. session, plausible score for the spawn interval, idempotent `matchId`).
- `window.__game` (E2E instrumentation) exists only when built with `VITE_E2E=true`; the public build does not expose it.
- No `dangerouslySetInnerHTML` and no `eval` (lint rules).

What this does **not** prevent: a player forging a plausible score. In production the answer is server-side validation by replaying the deterministic simulation from `seed` plus an input log, with rate limiting and signed sessions. That backend is out of scope for this challenge.

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

## Sections still to write

Local persistence, ranking/history integration and cache behaviour, pending-record recovery, balancing
notes and known limitations.
