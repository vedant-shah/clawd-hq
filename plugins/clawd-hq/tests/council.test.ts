import { expect, test } from 'claude-code/testing'
import { CHARACTERS, PALETTE } from '../hooks/avatar-data'
import { avatarFor, clawdAvatar, compactIcon, tinyIcon } from '../hooks/avatars'
import { councilIcon, councilTinyIcon } from '../hooks/council-avatar'
import { COUNCIL_LEAD, fillCouncil, runCouncil, voiceLine, withVoiceNotes } from '../hooks/council'
import { finishedSlots, floorSlots, pairGroups, parsePairUp } from '../hooks/pair-up'
import { trim } from '../hooks/pixels'
import type { Employee } from '../types'

const MIN = 60_000
const emp = (over: Partial<Employee> = {}): Employee => ({
  id: 'a1', type: 'general-purpose', description: 'Answer', mood: 'working', tools: 0, startedAt: 0, joinedTick: 0, ...over,
})
const voice = (id: string, question: string, at = 0, over: Partial<Employee> = {}) => emp({ id, pair: { goal: question, at, isCouncil: true }, ...over })
const colors = new Set(Object.values(PALETTE))
const filled = (grid: Array<Array<string | null>>) => grid.flat().filter((c): c is string => c !== null)
const rowsUsed = (grid: Array<Array<string | null>>, from: number, to: number) => grid.slice(from, to).filter(r => r.some(c => c !== null)).length

// ---- The COUNCIL line ----

test('a COUNCIL line comes off the brief like the pair-up line does, and gives the question and says it is a council', () => {
  expect(parsePairUp('COUNCIL: Should we move to Postgres?\nYou are the skeptic.')).toEqual({ goal: 'Should we move to Postgres?', isCouncil: true, prompt: 'You are the skeptic.' })
  expect(parsePairUp('council:   Keep the monolith?  \nGo.')).toEqual({ goal: 'Keep the monolith?', isCouncil: true, prompt: 'Go.' })
})

test('an empty question, or a COUNCIL line that is not first, leaves the brief as it was; a PAIR-UP line is not a council', () => {
  expect(parsePairUp('COUNCIL:   \nGo.')).toEqual({ prompt: 'COUNCIL:   \nGo.' })
  expect(parsePairUp('Go.\nCOUNCIL: x')).toEqual({ prompt: 'Go.\nCOUNCIL: x' })
  expect(parsePairUp('PAIR-UP: Ship it\nGo.')).toEqual({ goal: 'Ship it', prompt: 'Go.' })
})

// ---- Who forms a council ----

test('voices with the same question hired within the window are one council group, marked as one', () => {
  const groups = pairGroups([voice('a', 'Move to Postgres?'), voice('b', 'move to  postgres?', 2 * MIN), voice('c', 'Move to Postgres?', 3 * MIN)])
  expect(groups).toHaveLength(1)
  expect(groups[0]!.isCouncil).toBe(true)
  expect(groups[0]!.members.map(m => m.id)).toEqual(['a', 'b', 'c'])
})

test('a council and a pair-up with the same words stay apart, and one voice alone is no council', () => {
  const pair = emp({ id: 'p', pair: { goal: 'Move to Postgres?', at: 0 } })
  const groups = pairGroups([voice('a', 'Move to Postgres?'), pair, voice('b', 'Move to Postgres?', MIN), emp({ id: 'q', pair: { goal: 'Move to Postgres?', at: MIN } })])
  expect(groups.map(g => [g.isCouncil === true, g.members.map(m => m.id)])).toEqual([[true, ['a', 'b']], [false, ['p', 'q']]])
  expect(pairGroups([voice('a', 'Move to Postgres?')])).toEqual([])
  // A pair-up group carries no council mark at all.
  expect('isCouncil' in groups[1]!).toBe(false)
})

test('a council takes one slot on the floor and in the finished list, like a pair-up', () => {
  const staff = [voice('a', 'Q?'), voice('b', 'Q?', MIN)]
  expect(floorSlots(staff).map(s => s.kind)).toEqual(['pair'])
  const over = staff.map(s => ({ ...s, mood: 'done' as const, endedAt: 5 * MIN }))
  expect(finishedSlots(over, 0).map(s => s.kind)).toEqual(['pair'])
})

// ---- The first line of a voice's report ----

test('the first line of a report is plain words: marks, headings and code are left out', () => {
  expect(voiceLine('Go with option B.\nBecause it is cheaper.')).toBe('Go with option B.')
  expect(voiceLine('## Verdict\n\n**Pick B** because it is `cheap`.')).toBe('Pick B because it is cheap.')
  expect(voiceLine('```\ncode\n```\n- First, keep the monolith.')).toBe('First, keep the monolith.')
  expect(voiceLine('   \n\n')).toBeUndefined()
  expect(voiceLine('')).toBeUndefined()
})

test('a long first line is cut at a word with no mark, so a card can wrap it', () => {
  const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ')
  const line = voiceLine(long)!
  expect(line.length).toBeLessThanOrEqual(240)
  expect(long.startsWith(line)).toBe(true)
  expect(line).not.toMatch(/…|\.\.\.$/)
})

test('only a council voice keeps a report line; its choices are kept as before', () => {
  const one = voice('a', 'Q?')
  expect(withVoiceNotes(one, [], 'Pick B.\nWhy: cost.').report).toBe('Pick B.')
  expect(withVoiceNotes(one, ['Chose B'], 'Pick B.')).toMatchObject({ report: 'Pick B.', choices: ['Chose B'] })
  const alone = emp({ id: 'z' })
  expect(withVoiceNotes(alone, [], 'Pick B.')).toBe(alone)
  expect(withVoiceNotes(alone, ['Chose B'], 'Pick B.')).toMatchObject({ choices: ['Chose B'] })
  expect('report' in withVoiceNotes(alone, ['Chose B'], 'Pick B.')).toBe(false)
})

// ---- The council's own avatar ----

test('the council picture is 16 by 12 and 8 by 8, in the shared palette only', () => {
  const [icon, tiny] = [councilIcon(), councilTinyIcon()]
  expect([icon.length, icon.every(r => r.length === 16)]).toEqual([12, true])
  expect([tiny.length, tiny.every(r => r.length === 8)]).toEqual([8, true])
  for (const cell of [...filled(icon), ...filled(tiny)]) expect(colors.has(cell)).toBe(true)
})

test('three robed figures: the middle one taller than the two beside it, which match; a gavel is held up at its side', () => {
  for (const grid of [councilIcon(), councilTinyIcon()]) {
    const [w, h] = [grid[0]!.length, grid.length]
    const cols = (from: number, to: number) => grid.map(r => r.slice(from, to))
    const [left, mid, right] = [cols(0, Math.round(w * 0.3)), cols(Math.round(w * 0.3), Math.round(w * 0.7)), cols(Math.round(w * 0.7), w)]
    const top = (part: typeof left) => part.findIndex(r => r.some(c => c !== null))
    // The middle figure starts at the top; the sides begin lower, at the same row.
    expect(top(mid)).toBe(0)
    expect(top(left)).toBeGreaterThan(2)
    // Below the gavel, the sides are the same height: same row to start, same rows used, same robe colours.
    const below = Math.ceil(h * 0.5)
    expect(rowsUsed(left, below, h)).toBe(rowsUsed(right, below, h))
    expect(new Set(filled(left.slice(below)))).toEqual(new Set(filled(right.slice(below))))
    // The gavel is brown and sits high, above where either side's head begins.
    const rowOfBrown = grid.findIndex(r => r.includes(PALETTE.t!))
    expect(rowOfBrown).toBeGreaterThanOrEqual(0)
    expect(rowOfBrown).toBeLessThan(top(left))
  }
})

test('the council picture is not any person\'s: no hand-made character, Clawd or made-up look draws the same pixels', () => {
  const [icon, tiny] = [trim(councilIcon()), trim(councilTinyIcon())]
  const people = [...CHARACTERS, ...Array.from({ length: 30 }, (_, i) => avatarFor(`p:agent-${i}`))]
  for (const c of people) {
    expect(trim(compactIcon(c))).not.toEqual(icon)
    expect(trim(tinyIcon(c))).not.toEqual(tiny)
  }
  expect(trim(clawdAvatar().compact)).not.toEqual(icon)
})

// ---- The prompt-box fill and the /council command ----

const fakeIo = (isFilled = true) => {
  const filledWith: string[] = []
  const sent: string[] = []
  const toasts: string[] = []
  return {
    filledWith, sent, toasts,
    io: {
      fill: async (text: string) => (filledWith.push(text), { isFilled }),
      submit: async (text: string) => { sent.push(text) },
      later: async (fn: () => unknown) => { await fn() },
      toast: (text: string) => { toasts.push(text) },
    },
  }
}

test('the button only fills the prompt box with the lead words; nothing is sent', async () => {
  const f = fakeIo()
  expect(COUNCIL_LEAD).toBe('Hold a council on: ')
  await fillCouncil(f.io)
  expect(f.filledWith).toEqual(['Hold a council on: '])
  expect(f.sent).toEqual([])
  expect(f.toasts).toEqual([])
})

test('where the box cannot take the words, the person is told what to type', async () => {
  const f = fakeIo(false)
  await fillCouncil(f.io)
  expect(f.toasts).toEqual(['Type this in the chat: Hold a council on: '])
})

test('/council with a question sends "Hold a council on: <question>"; with none it fills the box instead', async () => {
  const f = fakeIo()
  const said = await runCouncil(f.io, '  Should we move to Postgres?  ')
  expect(f.sent).toEqual(['Hold a council on: Should we move to Postgres?'])
  expect(f.filledWith).toEqual([])
  expect(said).toContain('Should we move to Postgres?')
  const g = fakeIo()
  const empty = await runCouncil(g.io, '   ')
  expect(g.sent).toEqual([])
  expect(g.filledWith).toEqual(['Hold a council on: '])
  expect(empty).toMatch(/question/i)
})

test('a send that fails is told in a toast and the words are left in the prompt box, ready to send', async () => {
  const f = fakeIo()
  const bad = { ...f.io, submit: async () => { throw new Error('the engine said no') } }
  await runCouncil(bad, 'Q?')
  expect(f.filledWith).toEqual(['Hold a council on: Q?'])
  expect(f.toasts).toHaveLength(1)
  expect(f.toasts[0]).toContain('the engine said no')
  expect(f.toasts[0]).toContain('prompt box')
})

test('a send that fails where the box cannot take the words says what to type', async () => {
  const f = fakeIo(false)
  const bad = { ...f.io, submit: async () => { throw new Error('the engine said no') } }
  await runCouncil(bad, 'Q?')
  expect(f.toasts[0]).toContain('Type this in the chat: Hold a council on: Q?')
})
