import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import { loadConfig } from './config.js'
import { runCommands } from './runner.js'

/**
 * pi-notify walking skeleton (ticket #8) + extra ask-tool hook (ticket #12).
 *
 * Loads ~/.pi/pi-notify.json once (absent file = all hooks empty, silent
 * no-op; malformed file = throw naming the file and reason) and subscribes
 * `agent_settled` and `tool_call`. On each settle where `ctx.isIdle()` is
 * true, every `on_agent_finish` command runs in array order through `sh -c`,
 * fire-and-forget. On each `tool_call` whose `event.toolName` is an exact,
 * case-sensitive, full-string member of `extra_ask_user_tool`, every
 * `on_ask_user` command runs the same way, at call-start before the tool
 * executes. `tool_execution_start` is deliberately not subscribed (it fires
 * before `tool_call`, so subscribing to both would double-fire), nor are
 * `tool_execution_end` and the package `rpiv:ask-user:prompt` event (whose
 * payload carries no `toolCallId`).
 *
 * Observer-only: handlers never return a block decision and never mutate
 * event input. `agent_end` and `session_shutdown` are never subscribed.
 */
export default function (pi: ExtensionAPI): void {
  const config = loadConfig()
  const askTools = new Set(config.extra_ask_user_tool)

  pi.on('agent_settled', (_event, ctx) => {
    if (!ctx.isIdle()) return
    runCommands(config.on_agent_finish)
  })

  pi.on('tool_call', (event) => {
    if (!askTools.has(event.toolName)) return
    runCommands(config.on_ask_user)
  })
}
