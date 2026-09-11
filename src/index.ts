import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadConfig } from './config.js'
import { runCommands } from './runner.js'

/**
 * pi-notify walking skeleton (ticket #8): the `on_agent_finish` path.
 *
 * Loads ~/.pi/pi-notify.json once (absent file = all hooks empty, silent
 * no-op; malformed file = throw naming the file and reason) and subscribes
 * `agent_settled` only. On each settle where `ctx.isIdle()` is true, every
 * `on_agent_finish` command runs in array order through `sh -c`,
 * fire-and-forget.
 *
 * Observer-only: the handler never returns a block decision and never
 * mutates event input. `agent_end` and `session_shutdown` are never
 * subscribed.
 */
export default function (pi: ExtensionAPI): void {
  const config = loadConfig()

  pi.on('agent_settled', (_event, ctx) => {
    if (!ctx.isIdle()) return
    runCommands(config.on_agent_finish)
  })
}
