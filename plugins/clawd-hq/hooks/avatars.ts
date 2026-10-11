// The Clawd HQ avatars, pure: layered 24x24 sprites and 16x12 list icons built from the embedded parts.
import { BLINK, BODY, CHARACTERS, COMPACT, COMPACT_GRID, GRID, LAYER_ORDER, PALETTE, PARTS } from './avatar-data'
import type { Character, Part } from './avatar-data'
import { hash } from './office'

/** Palette colors (hex) or null where empty. */
export type Grid = Array<Array<string | null>>

const blank = (width: number, height: number): Grid => Array.from({ length: height }, () => Array.from({ length: width }, () => null))

/** A new grid with the part painted over the old one. */
function paint(grid: Grid, part: Part): Grid {
  return grid.map((row, y) => row.map((cell, x) => {
    const ch = part.rows[y - part.y]?.[x - part.x]
    return ch !== undefined && ch !== '.' ? PALETTE[ch] ?? cell : cell
  }))
}

const paintAll = (grid: Grid, parts: Part[]): Grid => parts.reduce(paint, grid)

/** The full 24x24 avatar: body, then outfit, emblem, expression, headwear and prop, each over the last. */
export function assemble(character: Character, isBlinking = false): Grid {
  const layers = LAYER_ORDER.map(layer => (layer === 'expression' && isBlinking ? BLINK : PARTS[layer]![character[layer]]!))
  return paintAll(blank(GRID.width, GRID.height), [BODY, ...layers])
}

/** The hand-drawn 16x12 list icon: body, hat, then the accent. */
export function compactIcon(character: Character): Grid {
  return paintAll(blank(COMPACT_GRID.width, COMPACT_GRID.height), [COMPACT.body, COMPACT.headwear[character.headwear]!, COMPACT.accent[character.compactAccent]!])
}

// ---- Lookup ----

/** The name of a type with its plugin prefix and any leading "(o_o)" face taken off, lower-cased. */
const bareName = (type: string) => type.replace(/^[^:]+:/, '').replace(/^\([^()]*\)\s*/, '').trim().toLowerCase()

const HAND_MADE = CHARACTERS.filter(c => c.id !== 'clawd')
const accentOfProp = Object.fromEntries(CHARACTERS.map(c => [c.prop, c.compactAccent]))

// Clawd's own marks (crown, star, logbook) stay his.
const POOLS = {
  outfit: Object.keys(PARTS.outfit!),
  headwear: Object.keys(PARTS.headwear!).filter(k => k !== 'crown_gold'),
  prop: Object.keys(PARTS.prop!).filter(k => k !== 'logbook'),
  emblem: Object.keys(PARTS.emblem!).filter(k => k !== 'star_gold'),
  expression: Object.keys(PARTS.expression!),
}

const pickFor = (pool: string[], name: string, layer: string) => pool[hash(`${name}:${layer}`) % pool.length]!

/** A look built from the name alone: the same name always gets the same parts. */
function madeUp(name: string): Character {
  const prop = pickFor(POOLS.prop, name, 'prop')
  return {
    id: name, label: name, short: name,
    outfit: pickFor(POOLS.outfit, name, 'outfit'),
    headwear: pickFor(POOLS.headwear, name, 'headwear'),
    prop,
    emblem: pickFor(POOLS.emblem, name, 'emblem'),
    expression: pickFor(POOLS.expression, name, 'expression'),
    compactAccent: accentOfProp[prop] ?? 'logbook',
  }
}

/** The hand-made character for an agent type (by its id, or its name without the plugin prefix), else one built from the name. */
export function avatarFor(agentType: string): Character {
  const whole = agentType.trim().toLowerCase()
  const bare = bareName(agentType)
  const found = HAND_MADE.find(c => c.id.toLowerCase() === whole) ?? HAND_MADE.find(c => bareName(c.id) === bare)
  return found ?? madeUp(bare)
}

// ---- Clawd ----

// A small red tie, drawn for now: Clawd has no crown and no emblem yet.
const TIE: Part[] = [{ x: 9, y: 15, rows: ['rr', 'rr', 'rr', 'rr'] }, { x: 8, y: 18, rows: ['rrrr'] }]
const TIE_ICON: Part = { x: 7, y: 6, rows: ['rr', 'rr'] }

/** Clawd's interim look: his outfit, expression and prop, no crown or emblem, plus the tie. Blinking swaps only the eyes. */
export function clawdAvatar(isBlinking = false): { full: Grid; compact: Grid } {
  const clawd = CHARACTERS.find(c => c.id === 'clawd')!
  const expression = isBlinking ? BLINK : PARTS.expression![clawd.expression]!
  const full = paintAll(blank(GRID.width, GRID.height), [BODY, PARTS.outfit![clawd.outfit]!, expression, PARTS.prop![clawd.prop]!, ...TIE])
  const compact = paintAll(blank(COMPACT_GRID.width, COMPACT_GRID.height), [COMPACT.body, COMPACT.accent[clawd.compactAccent]!, TIE_ICON])
  return { full, compact }
}
