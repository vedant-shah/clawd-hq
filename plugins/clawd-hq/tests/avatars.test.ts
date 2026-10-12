import { expect, test } from 'claude-code/testing'
import { assemble, avatarFor, clawdAvatar, compactIcon, tinyIcon } from '../hooks/avatars'
import { BODY, CHARACTERS, LAYER_ORDER, PALETTE, PARTS } from '../hooks/avatar-data'
import type { Character, Part } from '../hooks/avatar-data'

const colors = new Set(Object.values(PALETTE))
const cells = (grid: Array<Array<string | null>>) => grid.flat().filter((c): c is string => c !== null)
const lookOf = (c: Character) => [c.outfit, c.emblem, c.expression, c.headwear, c.prop].join('/')

test('a full avatar is 24 by 24 and a compact icon 16 by 12', () => {
  for (const c of CHARACTERS) {
    const full = assemble(c)
    expect(full).toHaveLength(24)
    expect(full.every(r => r.length === 24)).toBe(true)
    const icon = compactIcon(c)
    expect(icon).toHaveLength(12)
    expect(icon.every(r => r.length === 16)).toBe(true)
  }
})

test('every cell is a palette color or empty', () => {
  const made = Array.from({ length: 40 }, (_, i) => avatarFor(`plugin-${i}:agent-${i}`))
  for (const c of [...CHARACTERS, ...made]) {
    for (const cell of [...cells(assemble(c)), ...cells(compactIcon(c))]) expect(colors.has(cell)).toBe(true)
  }
})

test('later layers paint over earlier ones, the prop last', () => {
  const c = avatarFor('ecc:planner')
  const grid = assemble(c)
  const layers: Part[] = [BODY, ...LAYER_ORDER.map(layer => PARTS[layer]![c[layer]]!)]
  const colorAt = (p: Part, x: number, y: number) => {
    const ch = p.rows[y - p.y]?.[x - p.x]
    return ch && ch !== '.' ? PALETTE[ch] : undefined
  }
  let checked = 0
  layers.forEach((layer, i) => {
    layer.rows.forEach((row, dy) => [...row].forEach((ch, dx) => {
      if (ch === '.') return
      const [x, y] = [layer.x + dx, layer.y + dy]
      const covered = layers.slice(i + 1).some(later => colorAt(later, x, y) !== undefined)
      if (!covered) { expect(grid[y]![x]).toBe(PALETTE[ch]); checked += 1 }
    }))
  })
  expect(checked).toBeGreaterThan(100)
})

test('a hand-made character is found by its type, with or without a plugin prefix', () => {
  expect(avatarFor('ecc:planner').id).toBe('ecc:planner')
  expect(avatarFor('planner').id).toBe('ecc:planner')
  expect(avatarFor('my-plugin:planner').id).toBe('ecc:planner')
  expect(avatarFor('grill-me').id).toBe('grill-me')
  expect(avatarFor('someone:grill-me').id).toBe('grill-me')
  expect(avatarFor('legal:review-contract').id).toBe('legal:review-contract')
  expect(avatarFor('Planner').id).toBe('ecc:planner')
})

test('Clawd is never handed out as a specialist', () => {
  const boss = CHARACTERS.find(c => c.id === 'clawd')!
  expect(lookOf(avatarFor('clawd'))).not.toBe(lookOf(boss))
  expect(lookOf(avatarFor('x:clawd'))).not.toBe(lookOf(boss))
})

test('an unknown type gets the same made-up look every time', () => {
  const a = avatarFor('acme-ops:data-analyst')
  expect(avatarFor('acme-ops:data-analyst')).toEqual(a)
  expect(assemble(avatarFor('acme-ops:data-analyst'))).toEqual(assemble(a))
  // The name after the prefix decides, so the same agent from another plugin looks alike.
  expect(lookOf(avatarFor('other:data-analyst'))).toBe(lookOf(a))
  // A face carried in the type's name is not part of the look.
  expect(lookOf(avatarFor('acme-ops:(o_o) data-analyst'))).toBe(lookOf(a))
})

test('different unknown names mostly look different, and none borrows the boss look', () => {
  const names = Array.from({ length: 60 }, (_, i) => `team:agent-${i * 7}-${i % 5}`)
  const looks = new Set(names.map(n => lookOf(avatarFor(n))))
  expect(looks.size).toBeGreaterThanOrEqual(55)
  for (const n of names) {
    const c = avatarFor(n)
    expect(c.headwear).not.toBe('crown_gold')
    expect(c.emblem).not.toBe('star_gold')
    expect(c.prop).not.toBe('logbook')
    expect(PARTS.outfit![c.outfit]).toBeDefined()
    expect(PARTS.headwear![c.headwear]).toBeDefined()
    expect(PARTS.prop![c.prop]).toBeDefined()
  }
})

test('a made-up character still gets a compact icon, hat and accent included', () => {
  const icon = compactIcon(avatarFor('acme:ledger-keeper'))
  expect(icon).toHaveLength(12)
  expect(cells(icon).length).toBeGreaterThan(40)
})

test('Clawd wears his blazer and a red tie, with no crown or emblem', () => {
  const red = PALETTE.r
  const { full, compact } = clawdAvatar()
  expect(full).toHaveLength(24)
  expect(full[15]![9]).toBe(red)
  expect(full[15]![10]).toBe(red)
  expect(full[18]![8]).toBe(red)
  expect(full[18]![11]).toBe(red)
  // The crown would sit at the top, over the body's empty rows.
  expect(full.slice(0, 9).flat().every(c => c === null)).toBe(true)
  expect(compact).toHaveLength(12)
  for (const [x, y] of [[7, 6], [8, 6], [7, 7], [8, 7]] as const) expect(compact[y]![x]).toBe(red)
})

test('Clawd blinks by swapping only his eyes', () => {
  const open = clawdAvatar().full
  const shut = clawdAvatar(true).full
  const changed = open.flatMap((row, y) => row.map((c, x) => (c !== shut[y]![x] ? y : -1))).filter(y => y >= 0)
  expect(changed.length).toBeGreaterThan(0)
  expect(Math.min(...changed)).toBeGreaterThanOrEqual(10)
  expect(Math.max(...changed)).toBeLessThanOrEqual(13)
  expect(clawdAvatar(true).compact).toEqual(clawdAvatar().compact)
})

// ---- The tiny picture, for a terminal row ----

test('a tiny picture is 8 by 8, in palette colours only, and the same character always gets the same one', () => {
  const colours = new Set(Object.values(PALETTE))
  for (const c of CHARACTERS) {
    const grid = tinyIcon(c)
    expect(grid).toHaveLength(8)
    for (const row of grid) {
      expect(row).toHaveLength(8)
      for (const cell of row) expect(cell === null || colours.has(cell)).toBe(true)
    }
    expect(tinyIcon(c)).toEqual(grid)
  }
})

test('every tiny picture has the body, two eyes and legs, whatever it wears', () => {
  for (const c of CHARACTERS) {
    const grid = tinyIcon(c)
    expect([grid[3]![2], grid[3]![5]]).toEqual([PALETTE.k, PALETTE.k])
    expect(grid[2]!.slice(1, 7).every(cell => cell === PALETTE.o)).toBe(true)
    expect(grid[7]!.filter(Boolean).length).toBe(4)
  }
})

test('a tiny picture has no chest dots: the outfit is one colour across the chest', () => {
  for (const c of CHARACTERS) {
    const chest = tinyIcon(c)[4]!.slice(1, 7)
    expect(new Set(chest).size).toBe(1)
  }
})

test('every tiny picture keeps its hat on top and its prop at the raised claw', () => {
  for (const c of CHARACTERS) {
    const grid = tinyIcon(c)
    const hat = new Set(cells([...PARTS.headwear![c.headwear]!.rows].map(row => [...row].map(k => (k === '.' ? null : PALETTE[k] ?? null)))))
    const worn = cells([grid[0]!, grid[1]!])
    expect(worn.length).toBeGreaterThan(0)
    expect(worn.every(cell => hat.has(cell))).toBe(true)
    const held = new Set(cells([...PARTS.prop![c.prop]!.rows].map(row => [...row].map(k => (k === '.' ? null : PALETTE[k] ?? null)))))
    expect(grid[2]![7]).not.toBeNull()
    expect(held.has(grid[2]![7]!)).toBe(true)
    expect(grid[3]![7]).toBe(grid[2]![7])
  }
})

test('the hand-made characters do not all look alike when tiny, and a made-up one gets a picture too', () => {
  const made = CHARACTERS.filter(c => c.id !== 'clawd').map(c => JSON.stringify(tinyIcon(c)))
  expect(new Set(made).size).toBeGreaterThanOrEqual(Math.ceil(made.length * 0.8))
  expect(JSON.stringify(tinyIcon(avatarFor('acme:mystery')))).not.toBe(JSON.stringify(tinyIcon(avatarFor('designer'))))
})
