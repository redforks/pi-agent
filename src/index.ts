import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadConfig } from './config.js'
import { runCommands } from './runner.js'

/**
 * pi-notify: the `on_agent_finish` path (ticket #8) plus the native
 * `on_ask_user` path (ticket #11).
 *
 * Loads ~/.pi/pi-notify.json once (absent file = all hooks empty, silent
 * no-op; malformed file = throw naming the file and reason) and subscribes
 * `agent_settled` and `ui_prompt_start`. On each settle where `ctx.isIdle()`
 * is true, every `on_agent_finish` command runs in array order through
 * `sh -c`, fire-and-forget. On each observed `ui_prompt_start` — one per
 * waiting span, since the host coalesces nested/overlapping prompts into a
 * single outer span — every `on_ask_user` command runs the same way.
 *
 * Observer-only: handlers never return a block decision and never mutate
 * event input. `agent_end`, `session_shutdown` and `ui_prompt_end` are never
 * subscribed.
 */
export default function (pi: ExtensionAPI): void {
  const config = loadConfig()

  pi.on('agent_settled', (_event, ctx) => {
    if (!ctx.isIdle()) return
    runCommands(config.on_agent_finish)
  })

  pi.on('ui_prompt_start', () => {
    runCommands(config.on_ask_user)
  })
}
