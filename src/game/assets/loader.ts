import { Assets, Texture } from 'pixi.js'
import { buildManifest, type AssetEntry } from './manifest.ts'

export class AssetLoadError extends Error {
  readonly failed: readonly string[]
  constructor(failed: readonly string[]) {
    super(`Failed to load ${failed.length} game asset(s)`)
    this.name = 'AssetLoadError'
    this.failed = failed
  }
}

export interface GameTextures {
  get(name: string): Texture
  readonly retina: boolean
}

let cached: GameTextures | null = null
let inflight: Promise<GameTextures> | null = null

function wantsRetina(): boolean {
  return (window.devicePixelRatio || 1) >= 1.5
}

async function loadOne(entry: AssetEntry): Promise<[string, Texture, string | null]> {
  try {
    const texture = await Assets.load<Texture>({ alias: entry.url, src: entry.url })
    if (entry.resolution !== 1) texture.source.resolution = entry.resolution
    return [entry.name, texture, null]
  } catch {
    // A failed entry must not poison the cache, so a later retry can fetch it again.
    await Assets.unload(entry.url).catch(() => undefined)
    return [entry.name, Texture.EMPTY, entry.url]
  }
}

/**
 * Loads (or returns the already loaded) combat textures. Textures are shared across matches:
 * leaving and restarting a match reuses them instead of loading again. Rejects with
 * `AssetLoadError` if any texture fails; calling again retries only what is missing.
 */
export function loadGameAssets(onProgress?: (ratio: number) => void): Promise<GameTextures> {
  if (cached) {
    onProgress?.(1)
    return Promise.resolve(cached)
  }
  if (inflight) return inflight

  const retina = wantsRetina()
  const manifest = buildManifest(retina)
  let done = 0
  inflight = (async () => {
    const results = await Promise.all(
      manifest.map(async (entry) => {
        const result = await loadOne(entry)
        done += 1
        onProgress?.(done / manifest.length)
        return result
      }),
    )
    const failed = results.filter((r) => r[2] !== null).map((r) => r[2] as string)
    if (failed.length > 0) throw new AssetLoadError(failed)

    const textures = new Map(results.map(([name, texture]) => [name, texture]))
    cached = {
      retina,
      get(name) {
        const texture = textures.get(name)
        if (!texture) throw new Error(`Unknown game texture: ${name}`)
        return texture
      },
    }
    return cached
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** Drops every loaded texture (used by tests/profiling to prove nothing leaks). */
export async function unloadGameAssets(): Promise<void> {
  if (!cached) return
  const urls = buildManifest(cached.retina).map((e) => e.url)
  cached = null
  await Assets.unload(urls).catch(() => undefined)
}
