// The Artifact Desk: the pages Claude published or opened here, kept per project folder (hooks/artifacts.ts).
import type { EngineInterface, On } from 'claude-code'

import { CONNECTOR_PREFIX, CONNECTOR_PUBLISH_TOOLS, connectorToolOf, keepArtifact, keepConnectorArtifact, learnedPrefix } from './artifacts'
import type { ArtifactAnswer, ArtifactIo } from './artifacts'
import { ses, updateArtifacts } from './register-state'

export function artifactIo($: EngineInterface): ArtifactIo {
  return {
    folder: () => ses.cwd, now: () => $.clock.now(),
    change: fn => updateArtifacts($, fn),
    save: (folder, list) => $.store.set(`artifacts:${folder}`, list),
    warnOnce: text => { if (!ses.isArtifactsWarned) $.ui.toast(text); ses.isArtifactsWarned = true },
    check: i => $.tool.check(i as never), list: i => $.tool.call({ tool: 'Artifact', ...i }) as never,
    // The claude-artifacts connector, for the refresh in a session where the Artifact tool is not offered. Its server may carry a
    // prefix of its own on another machine, so the tool is named from the prefix a publish showed, else from the usual one.
    connector: {
      prefix: () => ses.artifactPrefix ?? CONNECTOR_PREFIX,
      check: (tool, input) => $.tool.check({ tool, input } as never),
      list: (tool, input) => $.tool.call({ tool, ...input } as never) as never,
    },
  }
}

export function registerArtifacts(on: On) {
  // A page Claude publishes or opens, by Clawd or by a specialist, joins the Artifact Desk on the Office tab.
  on('tool.call', { tool: 'Artifact' }, async ($, e, next) => {
    const folder = ses.cwd
    const ran = await next(e)
    // The tool's answer matters more than the desk: the save is started, not waited for, and a desk that cannot be kept is skipped, not thrown.
    void keepArtifact(artifactIo($), folder, e as unknown as Record<string, unknown>, ran as ArtifactAnswer).catch(() => undefined)
    return ran
  })

  // The same for a page published or edited through the claude-artifacts connector (the matcher is the broad net, `connectorToolOf` the rule).
  on('tool.call', { tool: CONNECTOR_PUBLISH_TOOLS }, async ($, e, next) => {
    const folder = ses.cwd
    const found = connectorToolOf(String(e.tool))
    if (found === undefined) return next(e)
    const ran = await next(e)
    // The server's prefix is learned only from a publish the desk took (a failed or refused one teaches nothing), and the exact server's is kept.
    void keepConnectorArtifact(artifactIo($), folder, e as unknown as Record<string, unknown>, ran as ArtifactAnswer)
      .then(isKept => { if (isKept) ses.artifactPrefix = learnedPrefix(ses.artifactPrefix, found.prefix) })
      .catch(() => undefined)
    return ran
  })
}
