import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import { PANE, START, SURFACES, host } from './host'

declare const setTimeout: (run: () => void, ms: number) => unknown

type Tree = { type: string; props: Record<string, unknown>; children?: unknown[] }
const elementsOf = (node: Tree) => (node.children ?? []).filter((c): c is Tree => typeof c === 'object' && c !== null && 'props' in c)
const walk = (node: Tree, hit: (t: Tree) => boolean): Tree[] => [...(hit(node) ? [node] : []), ...elementsOf(node).flatMap(c => walk(c, hit))]

/** A main-chat request on a model and effort, so the card knows them. */
async function request($: Engine) {
  const run = $.turn.step({ turnId: 'r1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 3 } as never)
  let part = await run.next()
  while (!part.done) part = await run.next()
  await new Promise<void>(resolve => setTimeout(resolve, 25))
}

test("Clawd's card: name and status, the model, his words in a box, then a dim hint for /council, and no button", async ($, on) => {
  host(on)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' } as never
  })
  await $.session.start(START)
  await request($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ plugin: 'clawd-hq', surface, ...PANE })
    const root = (await ui.drawn()) as unknown as Tree
    const [lines] = walk(root, t => t.props.key === 'clawd-lines')
    // (An amber line about lost rules may sit under the model line; it is not part of the layout.)
    const rows = elementsOf(lines!).filter(r => r.props.key !== 'clawd-rules-lost' && r.props.color === undefined)
    // Top to bottom: the head row, the model line, the quip in its bordered box, the hint, and nothing else.
    expect(rows.map(r => r.type)).toEqual(['Box', 'Text', 'Box', 'Text'])
    expect(rows[0]!.props.key).toBe('clawd-head')
    expect(rows[1]!.children?.join('')).toBe('Opus 5.5 · High')
    expect(rows[2]!.props.borderStyle).toBe('round')
    expect(walk(rows[2]!, t => t.type === 'Text')[0]!.props.italic).toBe(true)
    expect(rows[3]!.props.dimColor).toBe(true)
    expect(rows[3]!.children?.join('')).toBe('Type /council <question> to hold a council.')
    expect(walk(root, t => t.type === 'Button' && t.props.key === 'clawd-council')).toHaveLength(0)
    await ui.unmount()
  }
})
