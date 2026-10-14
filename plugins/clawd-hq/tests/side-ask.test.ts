import { expect, test } from 'claude-code/testing'
import { SIDE_WAITING, sideLine } from '../hooks/side-ask'

/** A task that runs until `finish` is called, and notes when it started. */
function held(name: string, ran: string[]) {
  let finish: () => void = () => undefined
  const done = new Promise<void>(resolve => { finish = resolve })
  return { run: () => { ran.push(name); return done }, finish: () => finish() }
}
/** Lets the promises already settled run their follow-ups. */
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve() }

test('a queued question runs at once when the line is free; the next waits for it and runs after, in order', async () => {
  const line = sideLine()
  const ran: string[] = []
  const [a, b, c] = [held('a', ran), held('b', ran), held('c', ran)]
  line.queue(a.run)
  line.queue(b.run)
  line.queue(c.run)
  expect(ran).toEqual(['a'])
  expect(line.isBusy()).toBe(true)
  a.finish()
  await settle()
  expect(ran).toEqual(['a', 'b'])
  b.finish()
  await settle()
  c.finish()
  await settle()
  expect(ran).toEqual(['a', 'b', 'c'])
  expect(line.isBusy()).toBe(false)
})

test('at most three wait; a fourth pushes out the oldest waiting one, which is told', async () => {
  const line = sideLine()
  const [ran, dropped] = [[] as string[], [] as string[]]
  const first = held('first', ran)
  line.queue(first.run)
  for (const n of ['w1', 'w2', 'w3', 'w4', 'w5']) line.queue(() => (ran.push(n), Promise.resolve()), () => dropped.push(n))
  expect(SIDE_WAITING).toBe(3)
  expect(dropped).toEqual(['w1', 'w2'])
  first.finish()
  for (let i = 0; i < 5; i += 1) await settle()
  expect(ran).toEqual(['first', 'w3', 'w4', 'w5'])
})

test('a question that may be skipped runs only when nothing runs or waits', async () => {
  const line = sideLine()
  const ran: string[] = []
  const a = held('a', ran)
  expect(line.tryNow(a.run)).toBe(true)
  expect(line.tryNow(() => (ran.push('skipped'), Promise.resolve()))).toBe(false)
  a.finish()
  await settle()
  expect(line.tryNow(() => (ran.push('now'), Promise.resolve()))).toBe(true)
  expect(ran).toEqual(['a', 'now'])
})

test('a question that fails does not stop the line', async () => {
  const line = sideLine()
  const ran: string[] = []
  line.queue(() => Promise.reject(new Error('the model is away')))
  line.queue(() => { throw new Error('thrown at once') })
  line.queue(() => (ran.push('after'), Promise.resolve()))
  for (let i = 0; i < 5; i += 1) await settle()
  expect(ran).toEqual(['after'])
  expect(line.isBusy()).toBe(false)
})

test('clearing the line drops what waits, each one told, and lets the running one finish', async () => {
  const line = sideLine()
  const [ran, dropped] = [[] as string[], [] as string[]]
  const a = held('a', ran)
  line.queue(a.run)
  line.queue(() => (ran.push('b'), Promise.resolve()), () => dropped.push('b'))
  line.clear()
  expect(dropped).toEqual(['b'])
  a.finish()
  await settle()
  expect(ran).toEqual(['a'])
})
