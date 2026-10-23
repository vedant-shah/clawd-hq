// The key choices a specialist reported (its DECIDED lines), drawn under its row in Settings > Finished this session.
// One wrapped dim line each, never cut with a mark. Plain text only: the words are an agent's, so nothing in them is read as a link or as Markdown.
import type { Employee } from '../types'
import type { Kit } from './panel-kit'

/** The notes of these specialists in order, one line each, or nothing when none reported a choice. */
export function choiceLines(kit: Kit, key: string, members: readonly Employee[]) {
  const { Text } = kit
  const notes = members.flatMap(one => one.choices ?? [])
  return notes.map((text, i) => <Text key={`${key}-choice-${i}`} dimColor wrap="wrap">{`Decided: ${text}`}</Text>)
}
