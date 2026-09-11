import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Pins the integration dispatch order: whichever hook is observed first
// enqueues its commands onto the runner FIFO first (ticket #13). Spawn is
// stubbed so the enqueue/spawn order is observed exactly, without racing real
// shell startup — complementing the real-shell completion checks in
// extension.test.ts and the runner unit tests in runner.test.ts.
const harness = vi.hoisted(() => ({
  spawned: [] as { command: string; args: string[] }[],
}))

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[]) => {
    harness.spawned.push({ command, args })
    return { on: () => {}, unref: () => {} }
  },
}))

import createExtension from '../src/index.js'

type Handler = (event: unknown, ctx: unknown) => unknown

function makeFakeAPI() {
  const handlers = new Map<string, Handler[]>()
  return {
    handlers,
    on: (event: string, handler: Handler) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
  }
}

function emit(api: ReturnType<typeof makeFakeAPI>, eventName: string, event: unknown, ctx: unknown): unknown[] {
  return (api.handlers.get(eventName) ?? []).map((h) => h(event, ctx))
}

const idleCtx = (isIdle: boolean) => ({ isIdle: () => isIdle })

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function shellCommands(): string[] {
  return harness.spawned.map((call) => call.args[1] as string)
}

let homeDir: string
let savedHome: string | undefined
let savedUserProfile: string | undefined

function writeConfig(contents: object) {
  mkdirSync(join(homeDir, '.pi'), { recursive: true })
  writeFileSync(join(homeDir, '.pi', 'pi-notify.json'), JSON.stringify(contents))
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'pi-notify-dispatch-'))
  savedHome = process.env.HOME
  savedUserProfile = process.env.USERPROFILE
  process.env.HOME = homeDir
  delete process.env.USERPROFILE
  harness.spawned.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  vi.restoreAllMocks()
})

describe('hook dispatch order onto the runner FIFO (#13)', () => {
  const nativeAsk = { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'select' }
  const settle = { type: 'agent_settled' }

  it('an ask observed before a settle enqueues the ask list first', async () => {
    writeConfig({ on_ask_user: ['ask-one', 'ask-two'], on_agent_finish: ['finish-one'] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'ui_prompt_start', nativeAsk, {})
    emit(api, 'agent_settled', settle, idleCtx(true))
    await flush()
    expect(shellCommands()).toEqual(['ask-one', 'ask-two', 'finish-one'])
  })

  it('a third-party ask observed before a settle enqueues the ask list first', async () => {
    writeConfig({
      on_ask_user: ['ask-one'],
      on_agent_finish: ['finish-one'],
      extra_ask_user_tool: ['ask_user_question'],
    })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(
      api,
      'tool_call',
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'ask_user_question', input: {} },
      {},
    )
    emit(api, 'agent_settled', settle, idleCtx(true))
    await flush()
    expect(shellCommands()).toEqual(['ask-one', 'finish-one'])
  })

  it('a settle observed before a later ask keeps the observed order', async () => {
    writeConfig({ on_ask_user: ['ask-one'], on_agent_finish: ['finish-one'] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', settle, idleCtx(true))
    emit(api, 'ui_prompt_start', nativeAsk, {})
    await flush()
    expect(shellCommands()).toEqual(['finish-one', 'ask-one'])
  })
})