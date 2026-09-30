# Performance report

Measurements for README section 9: combat performance of the **optimised production build** (60 FPS
target), frame-time percentiles and entity counts over three minutes of combat, and memory after five
start → play → leave cycles. Everything below comes from `scripts/profile` and the raw JSON files in
[`docs/perf-results/`](perf-results); nothing is estimated.

## Reference environment

| Item    | Value                                                                                          |
| ------- | ---------------------------------------------------------------------------------------------- |
| CPU     | 12th Gen Intel Core i7-12700F (12 cores / 20 threads)                                          |
| GPU     | NVIDIA GeForce RTX 3070, driver 32.0.16.1714                                                   |
| Memory  | 16 GiB DDR5-4800                                                                               |
| OS      | Windows 11 Pro (build 26200)                                                                   |
| Display | 1920x1080 at 180 Hz (`requestAnimationFrame` measured at 180 Hz)                               |
| Browser | Google Chrome 154.0.8037.92, headless, real GPU (ANGLE / Direct3D 11)                          |
| Build   | `pnpm build` (production bundle, no `window.__game` hook), served by `vite preview`            |
| Match   | 180 s session, **500 ms spawn interval** (the most demanding setting), default gameplay config |
| Commit  | `2773e24` (see `environment.json`)                                                             |

Launch flags: `--enable-gpu-rasterization --ignore-gpu-blocklist --mute-audio`. WebGL renderer reported by
the page: `ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 … Direct3D11)`.

## Method

- The app is driven through its real UI (name dialog, Options, Play) and the keyboard, in **real time**;
  the production build has no manual clock, so a 3-minute match takes 3 minutes.
- A keyboard bot holds forward and all three cannons and alternates turning every 3 s, so shells, impacts,
  explosions and enemies keep the effect pools busy. The bot has no access to game state.
- Frame times are the deltas between `requestAnimationFrame` callbacks recorded inside the page
  (`scripts/profile/lib/inpage.js`); the game's own sampler (`window.__perf`, enabled by `?perf=1`)
  gives the same result (see `gameSampler` in the JSON). "Entities" = enemies + shells + the player
  - active effect sprites.
- A blind bot is sunk within 9-21 s, so the **three-minute stretch is 180.1 s of combat frames chained over
  14 consecutive matches** (Play Again) rather than one uninterrupted 180 s match. The full 180 s session
  length and the 500 ms spawn interval are configured in every match.
- CPU/GPU-process usage comes from CDP `Performance.getMetrics` and `SystemInfo.getProcessInfo`; the trace
  summary from a Chrome trace (`devtools.timeline`, `v8.gc`, `gpu`).

## Results: reference run (3 minutes of combat)

| Metric                             | Result                                      |
| ---------------------------------- | ------------------------------------------- |
| Combat frames recorded             | 32,326 in 180.1 s (14 matches)              |
| **Average frame rate**             | **179.5 FPS** (display-bound: 180 Hz vsync) |
| Frame time p50 / **p95** / p99     | 5.6 ms / **5.7 ms** / 5.7 ms                |
| Worst frame                        | 133.4 ms (once, see "Spikes")               |
| Frames over the 16.7 ms budget     | 14 of 32,326 (0.043 %)                      |
| Frames over 2x budget / over 50 ms | 3 / 1                                       |
| **Entities**                       | **max 56, average 21.2**                    |
| Main-thread utilisation            | 11.9 % (0.74 ms of script/layout per frame) |
| Renderer / GPU process CPU         | 20 % / 32 % of one core                     |
| Whole-machine CPU                  | average 7.5 %, p95 11.1 %                   |
| JS heap during combat              | 9-16 MB, 9.7 MB after a forced GC           |

**The 60 FPS target is met with a large margin.** Because the display runs at 180 Hz, the run is capped at
180 FPS and the p95 frame time (5.7 ms) is one display refresh interval. The headroom run below removes
that cap.

### Headroom (vsync and frame limiter disabled, 60 s of combat)

| Metric             | Result                                           |
| ------------------ | ------------------------------------------------ |
| Average frame rate | **3,020 FPS** (mean frame 0.33 ms, p95 0.5 ms)   |
| Main-thread busy   | 69 % of one core while rendering ~3,000 frames/s |

That is roughly 16x above the 180 FPS reference run and about 50x above the 60 FPS target on this machine.

### Spikes

Two long tasks appear in the reference run: 127 ms at page start (script evaluation) and 133 ms when the
first match mounts (Pixi application creation, shader compilation and texture upload). Every later match
start costs one or two frames of about 33 ms. All are one-off costs at the boundaries between screens; there
are no long tasks during combat. In the 26 s Chrome trace: 24,103 renderer-main tasks, **1 over 50 ms**,
120 minor GCs (total 38.6 ms, worst 1.8 ms) and 3 major GCs (worst 2.7 ms). The renderer main thread is busy 8.7 % of
the time; the GPU process main thread shows 86 %, part of which is waiting on vsync, so the frame cost sits
on the GPU side rather than in script.

## Loading

| Metric                                        | Result                                          |
| --------------------------------------------- | ----------------------------------------------- |
| Main menu visible (cold, empty cache)         | 366 ms (FCP 348 ms)                             |
| Bundle                                        | 1.49 MB JS (483 KB gzip), 29 KB CSS (7 KB gzip) |
| Combat assets: click on Play to running match | 301 ms cold, 58 ms warm                         |

Textures are loaded once and shared through the Pixi cache, so later matches do not reload them.

## Memory: five start → play → leave cycles

Each cycle plays 20 s in real time with the bot, leaves through the pause dialog, forces a garbage
collection and measures (`memory.json`). Cycle 1 pays one-off costs (textures, sounds, JIT), so growth is
judged from cycle 1.

| Cycle | JS heap | DOM nodes | JS listeners | Canvases | AudioContexts alive | Renderer process | GPU process |
| ----- | ------- | --------- | ------------ | -------- | ------------------- | ---------------- | ----------- |
| 1     | 7.98 MB | 124       | 427          | 0        | 1                   | 220 MB           | 186 MB      |
| 2     | 8.21 MB | 124       | 425          | 0        | 1                   | 223 MB           | 189 MB      |
| 3     | 8.41 MB | 124       | 425          | 0        | 1                   | 214 MB           | 191 MB      |
| 4     | 8.57 MB | 124       | 425          | 0        | 1                   | 211 MB           | 189 MB      |
| 5     | 8.69 MB | 124       | 426          | 0        | 1                   | 210 MB           | 192 MB      |

Verdict of the script: **no continuous growth detected**. DOM nodes are constant, listener counts do not
trend (-0.2 per cycle), no canvas survives leaving a match, one `AudioContext` is reused, and renderer
memory trends down. The JS heap creeps by 0.18 MB per cycle, which is well within JIT and inline-cache
noise for 20 s cycles; the same shape appears with 2 s cycles. One WebGL context stays alive on the menu
by design (Pixi caches its capability-probe canvas); the count of live contexts is 1 in every cycle while
the created count rises by one per match, i.e. each match's context is released.

Methodology note: a first version of this check reported DOM nodes growing by 304 per cycle. Heap
snapshots showed the retainer was the DevTools console handle table, not the app: `page.waitForSelector`
returns an `ElementHandle` that the script never disposed, which pins the detached screens inside the
browser. The scripts now use `locator().waitFor()`, which retains nothing, and the growth disappeared.

## Other conditions (60 s of combat each)

| Condition                                              | Avg FPS  | p95 frame | Notes                                         |
| ------------------------------------------------------ | -------- | --------- | --------------------------------------------- |
| Mobile-like: 812x375, DPR 2, 4x CPU throttle, real GPU | 177.7    | 5.7 ms    | touch UI, 7 frames over 50 ms at match starts |
| Mobile-like: 812x375, DPR 3, 4x CPU throttle, real GPU | 177.6    | 5.7 ms    | same                                          |
| Software WebGL (SwiftShader), 1280x720, no GPU         | **20.6** | 50.1 ms   | worst case; below target                      |

## Limitations

- **One machine.** Numbers describe the reference environment above. A 180 Hz display and an RTX 3070 are
  far from a low-end phone.
- **Mobile is emulated.** CPU throttling (4x) and a phone-sized viewport approximate a slower CPU but do not
  slow the GPU, which is usually the constraint on real phones. The mobile rows show the JavaScript side is
  cheap (main thread 0.7 ms per frame), not that a specific phone will hold 60 FPS.
- **Software rendering misses the target.** Without hardware acceleration (SwiftShader, or a browser with
  hardware acceleration disabled) the game runs at about 20 FPS at 1280x720: the fixed-step simulation
  stays correct, but frames are dropped. Automated E2E tests run this way and are unaffected because they
  drive a manual clock.
- **Headless.** The runs use headless Chrome on the real GPU (no window). The rendering path is the same as a
  windowed Chrome, but a windowed run was not measured.
- **Bot, not a person.** The bot dies quickly, so the three minutes are chained matches. Entity counts of a
  human player who survives longer at a 500 ms spawn interval are capped by the 10-enemy limit of the
  simulation, so they should be of the same order.
- **Audio.** Sound playback is included (1,565 buffer sources created, all but 5 ended) but the browser is
  started with `--mute-audio`, so the device output cost is not measured.

## Reproducing

```bash
pnpm build
pnpm profile -- --headless                       # everything (about 15 minutes of real time)
pnpm profile -- --headless --suite combat        # the 3-minute reference run
pnpm profile -- --headless --suite memory --cycles 5 --cycle-seconds 20
pnpm profile -- --suite load,trace               # cold load and a traced combat run
```

Suites: `env`, `load`, `combat` (reference), `uncapped`, `software`, `mobile`, `trace`, `memory`. Omit
`--headless` to use a visible Chrome window. Results are written to `docs/perf-results/*.json`; the
per-frame arrays are in `combat-*.json` (`rawFrameMs`). Requires an installed Google Chrome for the GPU
suites; `software` uses Playwright's bundled Chromium.
