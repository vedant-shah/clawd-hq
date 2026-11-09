// The slash commands: /office, /office-setup, /office-council and /office-demo. They are registered at session start (register-session.ts).
import type { On } from 'claude-code'

import { runCouncil } from './council'
import { startDemo } from './demo'
import type { BriefingOptions } from './instructions'
import { BRAND } from './office'
import { restartOnboard } from './onboard'
import { noFolderCard, noFolderLine } from './onboard-cards'
import { openPanes } from './panes'
import { councilIo, demoIo, paneIo } from './register-io'
import { folderIo, onboardIo } from './register-setup'
import { ses } from './register-state'
import { followFolder, setupFolder } from './session-folder'

export function registerCommands(on: On, brief: BriefingOptions) {
  on('command.run', { command: 'office' }, async $ => {
    await openPanes(paneIo($), true)
    return { text: `${BRAND} is open: Office · People · Settings are the tabs at the top.` }
  })

  // `/office-setup <folder>` looks at the folder given; the team and the rest stay filed under the session's own (hooks/session-folder.ts).
  on('command.run', { command: 'office-setup' }, async ($, e) => {
    await openPanes(paneIo($), true)
    await followFolder(folderIo($, brief)) // the host may have moved the session since it started
    const io = await onboardIo($, brief)
    const { folder, refused } = await setupFolder(e.args, ses.cwd, io.home(), io.isFolder)
    if (refused !== undefined) {
      if ((await io.card())?.step !== 'scan') await io.setCard(noFolderCard(refused)) // a setup already running keeps its card: the answer says it
      return { text: `${BRAND} ${noFolderLine(refused).replace(/^Setup/, 'setup')}` }
    }
    void restartOnboard(folder === undefined ? io : { ...io, scanFolder: folder }).catch(() => undefined) // the model calls are not waited for
    return { text: `${BRAND} setup is running for this project. A small card on the Office tab says what was set up.` }
  })

  on('command.run', { command: 'office-council' }, async ($, e) => ({ text: await runCouncil(councilIo($), e.args) }))

  on('command.run', { command: 'office-demo' }, async $ => {
    await openPanes(paneIo($), false)
    await startDemo(demoIo($))
    return { text: `The ${BRAND} tour is playing in the side panel (about 90 seconds).` }
  })
}
