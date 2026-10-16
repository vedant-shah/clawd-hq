// The colour a usage number reads in: plain while there is room, amber when it is filling, red when it is nearly full.
import { AMBER, RED } from './office'

/** From this percent on (as it reads) a number is amber. */
export const WARN_AT = 70
/** From this percent on (as it reads) a number is red. */
export const ALERT_AT = 90
const MAX_PERCENT = 100

/** The colour for a usage percent; undefined (the normal colour) below the first threshold or with no usable reading. */
export function usageTint(percent: number | undefined): string | undefined {
  if (percent === undefined || !Number.isFinite(percent)) return undefined
  const shown = Math.round(Math.min(MAX_PERCENT, Math.max(0, percent)))
  if (shown >= ALERT_AT) return RED
  return shown >= WARN_AT ? AMBER : undefined
}
