import type { RouletteApi } from '../../shared/types'

declare global {
  interface Window {
    roulette: RouletteApi
  }
}

export {}
