// The switchboard: wires each feature to Claude Code's events. Each feature's hooks live in its own register-*.ts; this calls them.
// Handlers of one event keep their order (tool.call: the Artifact desk, then the file tools, then every tool; command.run: office,
// office-setup, office-council, office-demo; ui.render: the quiet rows, then the panes). The state they share is in register-state.ts.
import type { Register } from 'claude-code'

import { optionsOf } from './instructions'
import { registerAgents } from './register-agents'
import { registerArtifacts } from './register-artifacts'
import { registerCoffee } from './register-coffee'
import { registerCommands } from './register-commands'
import { registerKnow } from './register-know'
import { registerLeft } from './register-left'
import { registerPanes } from './register-panes'
import { registerQuiet } from './register-quiet'
import { registerRules } from './register-rules'
import { registerSession } from './register-session'
import { registerTools } from './register-tools'
import { registerTurns } from './register-turns'
import { liveOptions } from './toggle-store'

export const register: Register = (on, options) => {
  const brief = liveOptions(optionsOf(options)) // each switch read when used: a saved press first (hooks/toggle-store.ts)

  registerRules(on, brief)
  registerSession(on, brief)
  registerAgents(on, brief)
  registerCommands(on, brief)
  registerCoffee(on)
  registerArtifacts(on)
  registerLeft(on)
  registerTools(on, brief)
  registerTurns(on, brief)
  registerKnow(on, brief)
  registerQuiet(on, brief)
  registerPanes(on, brief)
}
