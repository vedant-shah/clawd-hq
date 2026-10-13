// The Clawd HQ avatars, pure: layered 24x24 sprites, 16x12 list icons and 8x8 tiny pictures built from the embedded parts.
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

/** A moment of a picture's small motions: the eyes shut for a blink, and what it holds raised one dot while it works. */
export type Pose = { isBlinking?: boolean; isLifted?: boolean }

const raised = (part: Part): Part => ({ ...part, y: part.y - 1 })

/** The full 24x24 avatar: body, then outfit, emblem, expression, headwear and prop, each over the last. */
export function assemble(character: Character, pose: Pose = {}): Grid {
  const layers = LAYER_ORDER.map(layer => {
    const part = layer === 'expression' && pose.isBlinking ? BLINK : PARTS[layer]![character[layer]]!
    return layer === 'prop' && pose.isLifted ? raised(part) : part
  })
  return paintAll(blank(GRID.width, GRID.height), [BODY, ...layers])
}

/** The hand-drawn 16x12 list icon: body, hat, then the accent. */
export function compactIcon(character: Character): Grid {
  return paintAll(blank(COMPACT_GRID.width, COMPACT_GRID.height), [COMPACT.body, COMPACT.headwear[character.headwear]!, COMPACT.accent[character.compactAccent]!])
}

// ---- The tiny picture: 8 by 8, for a terminal row, where a picture cannot be scaled ----

export const TINY_GRID = { width: 8, height: 8 } as const
const [BODY_KEY, SHADE_KEY, INK_KEY] = ['o', 'd', 'k']

/** The colour key most cells hold, leaving out the ones named; nothing when no cell counts. */
function commonest(keys: string[], except: string[] = []): string | undefined {
  const counts = new Map<string, number>()
  for (const k of keys) if (k !== '.' && !except.includes(k)) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

const cellsOf = (part: Part) => part.rows.flatMap(row => [...row])

/** The columns of the 24-wide drawing that tiny column `c` stands for: the body's 14 columns go to the middle six. */
const spanOf = (c: number): [number, number] => (c === 0 ? [0, 3] : c === 7 ? [17, 20] : [3 + Math.round(((c - 1) * 14) / 6), 3 + Math.round((c * 14) / 6)])

/** A hat as two rows of eight: each cell takes the colour most of its patch of the big hat holds, or stays empty where the hat is thin. */
function tinyHat(hat: Part): Array<Array<string | undefined>> {
  const height = hat.rows.length
  return [0, 1].map(band => {
    const [top, bottom] = [Math.floor((band * height) / 2), Math.max(Math.floor((band * height) / 2) + 1, Math.ceil(((band + 1) * height) / 2))]
    return Array.from({ length: TINY_GRID.width }, (_, c) => {
      const [from, to] = spanOf(c)
      const patch = hat.rows.slice(top, bottom).flatMap(row => Array.from({ length: to - from }, (_, i) => row[from + i - hat.x] ?? '.'))
      const filled = patch.filter(k => k !== '.')
      return filled.length * 3 >= patch.length ? commonest(filled) : undefined
    })
  })
}

/**
 * The 8 by 8 picture of a character: its hat in two rows, the body with two eyes, its outfit's colour across the
 * lower body, a dab of its prop's colour at the raised claw, and the legs. A blink shades the eyes; a lift moves the dab up a dot.
 */
export function tinyIcon(character: Character, pose: Pose = {}): Grid {
  const outfit = commonest(cellsOf(PARTS.outfit![character.outfit] ?? BODY), [BODY_KEY, SHADE_KEY, INK_KEY]) ?? BODY_KEY
  const prop = commonest(cellsOf(PARTS.prop![character.prop] ?? BODY), [INK_KEY, BODY_KEY, SHADE_KEY])
  const hat = PARTS.headwear![character.headwear]
  const [top, brim] = hat ? tinyHat(hat) : [[], []]
  const [o, eye] = [BODY_KEY, pose.isBlinking ? SHADE_KEY : INK_KEY]
  // The dab at the claw, down the last column of rows 1 to 3: two dots tall, one row higher when lifted.
  const held = pose.isLifted ? [prop, prop, undefined] : [undefined, prop, prop]
  const rows: Array<Array<string | undefined>> = [
    Array.from({ length: 8 }, (_, c) => top![c]),
    // A hat that reaches the last column keeps its cell: the dab only rises into empty room.
    Array.from({ length: 8 }, (_, c) => (c === 7 ? brim![c] ?? held[0] : brim![c])),
    [undefined, o, o, o, o, o, o, held[1]],
    [undefined, o, eye, o, o, eye, o, held[2]],
    [o, outfit, outfit, outfit, outfit, outfit, outfit, o],
    [undefined, outfit, outfit, outfit, outfit, outfit, outfit, undefined],
    [undefined, o, undefined, SHADE_KEY, SHADE_KEY, undefined, o, undefined],
    [undefined, o, undefined, SHADE_KEY, SHADE_KEY, undefined, o, undefined],
  ]
  return rows.map(row => row.map(k => (k === undefined ? null : PALETTE[k] ?? null)))
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

// The small drawing's eyes are two dots tall: a blink covers the upper dot of each with the body's colour.
const BLINK_ICON: Part = { x: 0, y: 5, rows: ['.....o....o.....'] }

/** Clawd's interim look: his outfit, expression and prop, no crown or emblem, plus the tie. A blink swaps only the eyes; a lift raises his logbook a dot. */
export function clawdAvatar(pose: Pose = {}): { full: Grid; compact: Grid } {
  const clawd = CHARACTERS.find(c => c.id === 'clawd')!
  const expression = pose.isBlinking ? BLINK : PARTS.expression![clawd.expression]!
  const [prop, accent] = [PARTS.prop![clawd.prop]!, COMPACT.accent[clawd.compactAccent]!]
  const full = paintAll(blank(GRID.width, GRID.height), [BODY, PARTS.outfit![clawd.outfit]!, expression, pose.isLifted ? raised(prop) : prop, ...TIE])
  const compact = paintAll(blank(COMPACT_GRID.width, COMPACT_GRID.height),
    [COMPACT.body, ...(pose.isBlinking ? [BLINK_ICON] : []), pose.isLifted ? raised(accent) : accent, TIE_ICON])
  return { full, compact }
}
