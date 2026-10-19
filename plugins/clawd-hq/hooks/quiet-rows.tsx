// The quiet chat's two ways to draw a row: as nothing, or as the look in hooks/quiet.ts says. No `$`: the drawing table comes in as `resolve`.
import type { EngineInterface, RenderElement } from 'claude-code'
import type { rowLook } from './quiet'

/** `$.ui.resolve`, handed in as a closure: picks the drawing surface's own elements for a render event. */
export type Resolve = EngineInterface['ui']['resolve']
type RenderEvent = Parameters<Resolve>[0]

/** A row drawn as nothing. */
export function blank(resolve: Resolve, e: RenderEvent) {
  const { Text } = resolve(e)
  return <Text>{''}</Text>
}

/** A small row as its look says: drawn as it is, as nothing, or dimmed. */
export async function smallRow(resolve: Resolve, e: RenderEvent, look: ReturnType<typeof rowLook>, draw: () => Promise<RenderElement>): Promise<RenderElement> {
  if (look === 'show') return draw()
  if (look === 'hide') return blank(resolve, e)
  const { Text } = resolve(e)
  return <Text dimColor>{await draw()}</Text>
}
