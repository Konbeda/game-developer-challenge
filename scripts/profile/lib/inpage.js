/*
 * In-page instrumentation, injected before any page script (context.addInitScript).
 *
 * It is deliberately independent of the game's own `window.__perf` sampler, which is only alive
 * while a host exists and only exposes summaries. Everything here lives in `window.__prof`:
 *
 *  - frame intervals (requestAnimationFrame deltas) recorded ONLY while the match phase is
 *    'running' (read from `data-phase` on the game screen), so menus, loading and pauses never
 *    pollute the combat numbers. `span` increments each time a running stretch starts.
 *  - long tasks (>= 50 ms) from the PerformanceObserver.
 *  - WebGL contexts created / still alive (WeakRef), AudioContexts and buffer sources created /
 *    ended: hints for leaked GPU or audio resources after a forced GC.
 *
 * No timers, no polling: one rAF callback per frame plus a MutationObserver on the DOM.
 */
;(() => {
  if (window.__prof) return

  const CAP = 600_000
  const at = new Float64Array(CAP)
  const dt = new Float32Array(CAP)
  const span = new Uint16Array(CAP)

  const prof = {
    n: 0,
    spans: 0,
    /** Sum of every recorded frame interval (ms): the combat time accumulated so far. */
    sumMs: 0,
    phase: null,
    /** performance.now() marks: first menu render, and each time the game screen appears / starts running. */
    menuAt: null,
    gameAt: [],
    runningAt: [],
    longtasks: [],
    gl: { created: 0, refs: [] },
    audio: { contexts: 0, contextRefs: [], sources: 0, ended: 0 },
  }
  window.__prof = prof

  // ---- phase tracking --------------------------------------------------------------------
  const readPhase = () => {
    const el = document.querySelector('[data-screen="game"]')
    return el ? (el.getAttribute('data-phase') ?? null) : null
  }
  let gameShown = false
  const onMutation = () => {
    const previous = prof.phase
    prof.phase = readPhase()
    const now = performance.now()
    if (prof.menuAt === null && document.querySelector('[data-testid="screen-menu"]')) {
      prof.menuAt = now
    }
    const game = document.querySelector('[data-screen="game"]') !== null
    if (game && !gameShown) prof.gameAt.push(now)
    gameShown = game
    if (prof.phase === 'running' && previous !== 'running') prof.runningAt.push(now)
  }
  const startObserver = () => {
    onMutation()
    new MutationObserver(onMutation).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-phase'],
    })
  }
  if (document.documentElement) startObserver()
  else document.addEventListener('DOMContentLoaded', startObserver, { once: true })

  // ---- frame intervals ---------------------------------------------------------------------
  let last = 0
  let wasRunning = false
  const frame = (now) => {
    const running = prof.phase === 'running'
    if (running) {
      if (!wasRunning) prof.spans += 1
      if (wasRunning && prof.n < CAP) {
        at[prof.n] = now
        dt[prof.n] = now - last
        span[prof.n] = prof.spans
        prof.n += 1
        prof.sumMs += now - last
      }
    }
    wasRunning = running
    last = now
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)

  prof.snapshot = (from = 0) => {
    const round = (v) => Math.round(v * 1000) / 1000
    return {
      total: prof.n,
      at: Array.from(at.subarray(from, prof.n), round),
      dt: Array.from(dt.subarray(from, prof.n), round),
      span: Array.from(span.subarray(from, prof.n)),
    }
  }

  // ---- long tasks --------------------------------------------------------------------------
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        prof.longtasks.push([Math.round(entry.startTime), Math.round(entry.duration)])
      }
    }).observe({ type: 'longtask', buffered: true })
  } catch {
    // longtask not supported: the array simply stays empty.
  }

  // ---- WebGL contexts ----------------------------------------------------------------------
  const wrapGetContext = (proto) => {
    if (!proto || !proto.getContext) return
    const original = proto.getContext
    proto.getContext = function (type, ...rest) {
      const ctx = original.call(this, type, ...rest)
      if (ctx && typeof type === 'string' && type.includes('webgl') && !ctx.__profSeen) {
        Object.defineProperty(ctx, '__profSeen', { value: true })
        prof.gl.created += 1
        prof.gl.refs.push(new WeakRef(ctx))
      }
      return ctx
    }
  }
  wrapGetContext(window.HTMLCanvasElement && HTMLCanvasElement.prototype)
  wrapGetContext(window.OffscreenCanvas && OffscreenCanvas.prototype)
  prof.glAlive = () =>
    prof.gl.refs.filter((ref) => {
      const ctx = ref.deref()
      return ctx !== undefined && !ctx.isContextLost()
    }).length
  prof.glRetained = () => prof.gl.refs.filter((ref) => ref.deref() !== undefined).length

  // ---- Web Audio -----------------------------------------------------------------------------
  const OriginalAudioContext = window.AudioContext
  if (OriginalAudioContext) {
    window.AudioContext = class extends OriginalAudioContext {
      constructor(...args) {
        super(...args)
        prof.audio.contexts += 1
        prof.audio.contextRefs.push(new WeakRef(this))
      }
    }
    const proto = window.BaseAudioContext && BaseAudioContext.prototype
    if (proto && proto.createBufferSource) {
      const create = proto.createBufferSource
      proto.createBufferSource = function (...args) {
        const source = create.apply(this, args)
        prof.audio.sources += 1
        source.addEventListener('ended', () => (prof.audio.ended += 1), { once: true })
        return source
      }
    }
  }
  prof.audioContextsAlive = () =>
    prof.audio.contextRefs.filter((ref) => {
      const ctx = ref.deref()
      return ctx !== undefined && ctx.state !== 'closed'
    }).length
})()
