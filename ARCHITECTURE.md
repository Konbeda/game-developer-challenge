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

## Sections still to write

React/Pixi integration, simulation loop, collisions, resource management, local persistence, ranking/history integration and cache behavior, balancing decisions, known limitations.
