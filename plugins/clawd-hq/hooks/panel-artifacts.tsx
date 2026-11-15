// The pages Claude made in this project (hooks/artifacts.ts keeps the list), as the History board draws them under "Artifacts · N": each title a link
// at the left, how long ago and a dim Hide button at the right; the newest few, and the rest on asking.
import { ARTIFACT_SHOWN, realArtifacts } from './artifacts'
import type { Ctx } from './panel-desk'
import { cellText } from './wrap-to'

/** The rows (all of them, or the newest few), and how many older ones are left out. */
export function artifactRows({ kit, data, actions }: Pick<Ctx, 'kit' | 'data' | 'actions'>, isAll: boolean, age: (ms: number) => string): { rows: JSX.Element[]; older: number } {
  const { Box, Text, Link, Button } = kit
  const real = realArtifacts(data.artifacts)
  const shown = isAll ? real : real.slice(0, ARTIFACT_SHOWN)
  const rows = shown.map(one => (
    // A long title wraps under itself and is never cut with a mark; the time and Hide keep their place at the right.
    <Box key={`artifact-${one.url}`} flexDirection="row" justifyContent="space-between" columnGap={1}>
      <Box flexShrink={1}><Text wrap="wrap"><Link href={one.url}>{kit.isTerminal ? cellText(one.title) : one.title}</Link></Text></Box>
      <Box flexDirection="row" flexShrink={0} columnGap={kit.isTerminal ? 3 : 'sm'}>
        <Text dimColor>{age(data.now - one.at)}</Text>
        <Button key={`artifact-hide-${one.url}`} plain dimColor label="Hide" onPress={() => actions.hideArtifact(one.url)} />
      </Box>
    </Box>
  ))
  return { rows, older: Math.max(0, real.length - ARTIFACT_SHOWN) }
}
