# Pirate Battle — Development Plan

Living to-do list. Infrastructure first; the game itself comes last.
Status legend: `[ ]` todo · `[~]` in progress · `[x]` done.

## Decisions

| Topic            | Decision                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| Build            | Vite + React + TypeScript (strict)                                     |
| Rendering        | PixiJS v8                                                              |
| Package manager  | pnpm (lockfile committed)                                              |
| Styling          | Tailwind CSS                                                           |
| UI state         | Zustand (screens, options, throttled HUD)                              |
| Remote state     | TanStack Query + Axios                                                 |
| Mocking          | MSW (also in the published build)                                      |
| E2E              | Playwright (Chromium, desktop + mobile)                                |
| Unit tests       | Vitest (simulation, outbox)                                            |
| Validation       | Zod schemas for every external input (allowlist regex for player name) |
| Error monitoring | Sentry, DSN via env var, no-op when empty                              |
| Deploy           | Vercel (SPA fallback)                                                  |
| Mobile           | Landscape only, rotate prompt in portrait                              |

## Threat model (summary — full text goes to ARCHITECTURE.md)

The game is client-side by requirement, so the client is untrusted and scores can be tampered with.
Mitigations that fit the scope: contracts designed as if a server existed (`seed`, `config`, `durationMs`
on every record), sanity validation in the MSW handlers, idempotent `matchId`, test hooks
(`window.__game`) enabled only by a build flag, sanitised `localStorage` reads.
Production answer (documented, not built): server-side replay of the deterministic simulation from seed + input log.

## Phase 0 — Foundation

- [ ] Deadline estimate (README asks for it before starting)
- [x] Vite + React + TS strict scaffold, pnpm, Tailwind
- [x] oxlint, Prettier, scripts: `dev` `build` `preview` `lint` `typecheck` `test` `e2e` (Playwright config still pending, Phase 5)
- [x] Sentry wired with optional DSN, `.env.example`
- [ ] CI (lint, typecheck, unit, build)
- [ ] First deploy (empty page) incl. SPA fallback and MSW service worker in production

- [ ] Validation layer `src/lib/validation`: Zod schemas shared by app, MSW and tests; hostile-input unit tests; lint rule banning `dangerouslySetInnerHTML`
- [ ] Player name modal (first visit, 1-16 chars, no login, local `playerId`)

## Phase 1 — Asset pipeline

- [ ] Serve `assets/`; typed manifest; 1x/2x selection by `devicePixelRatio`
- [ ] Loader with progress, failure and retry
- [ ] `ASSETS_LICENSES.md` (verify asset licenses)

## Phase 2 — Contracts and network (ranking + history)

- [ ] Typed contracts (`MatchRecord`, pages, errors)
- [ ] Axios client (timeout, cancellation)
- [ ] TanStack Query hooks: invalidation on both tabs, stale-response protection
- [ ] MSW handlers, fixtures, localStorage-backed store
- [ ] Scenarios: success, empty, multi-page, slow, variable latency, out-of-order, timeout, 4xx/5xx, post-commit timeout, outage at match end
- [ ] Scenario selector + reset (dev panel and query param)
- [ ] Pending-record outbox with idempotent retry
- [ ] Ranking per configuration with deterministic tie-break (score desc, duration asc, date asc, id)

## Phase 3 — Application shell (no game)

- [ ] Main menu, Options (validation, persistence), Result screen (record status)
- [ ] Ranking and Match History tabs: pagination, loading, empty, error
- [ ] Accessibility: focus, dialogs, labels, contrast, moderate `aria-live`
- [ ] Responsive layout, landscape on mobile
- [ ] Last completed match persisted

## Phase 4 — Combat scaffolding

- [ ] Typed central gameplay config, snapshot per match
- [ ] Simulation contract: fixed timestep, seeded RNG, injectable clock
- [ ] Pixi host lifecycle (Strict Mode, cleanup, resize, DPR, auto-pause on blur/hidden)
- [ ] React sync outside the frame loop
- [ ] Input capture only during gameplay (keyboard + touch)
- [ ] Test hook `window.__game` behind a build flag

## Phase 5 — Test and performance infrastructure

- [ ] Playwright config (desktop + mobile, HTML report, traces, isolation, visual baselines)
- [ ] Specs for shell and network (README items 1, 2, 8, 10, 11, 12)
- [ ] Profiling harness: FPS, p95 frame time, entities, 5-cycle memory check

## Phase 6 — The game

- [ ] Arena, islands, collisions
- [ ] Player, projectiles, cooldowns
- [ ] Chaser, Shooter, spawning
- [ ] Scoring, end conditions, restart
- [ ] Effects, ship deterioration, audio, HUD
- [ ] Combat specs (README items 3–7, 9)

## Phase 7 — Wrap-up

- [ ] Balancing, final profiling report
- [ ] `README.md` and `ARCHITECTURE.md` (English)
- [ ] Final deploy, clean-checkout verification
