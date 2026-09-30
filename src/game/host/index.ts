import type { GameHost } from '../contracts.ts'
import { PixiGameHost } from './pixiHost.ts'

export function createGameHost(): GameHost {
  return new PixiGameHost()
}
