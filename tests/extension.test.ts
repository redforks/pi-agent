import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import createExtension from '../src/index.js'

type Handler = (event: unknown, ctx: unknown) => unknown

interface FakeAPI {
  handlers: Map<string, Handler[]>
  on: (event: string, handler: Handler) => void
}

function makeFakeAPI(): FakeAPI {
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

function emit(api: FakeAPI, eventName: string, event: unknown, ctx: unknown): unknown[] {
  return (api.handlers.get(eventName) ?? []).map((h) => h(event, ctx))
}

function idleCtx(isIdle: boolean) {
  return { isIdle: () => isIdle }
}

async function waitUntil(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil timed out')
    await new Promise((r) => setTimeout(r, 25))
  }
}

// Temp home holding the config: the extension resolves the home from the
// process environment, so tests point HOME at a fresh temp dir.
let homeDir: string
let savedHome: string | undefined
let savedUserProfile: string | undefined

function writeConfig(contents: string | object) {
  mkdirSync(join(homeDir, '.pi'), { recursive: true })
  writeFileSync(
    join(homeDir, '.pi', 'pi-notify.json'),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  )
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'pi-notify-home-'))
  savedHome = process.env.HOME
  savedUserProfile = process.env.USERPROFILE
  process.env.HOME = homeDir
  delete process.env.USERPROFILE
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  if (savedHome === undefined) delete process.env.HOME
  else process.env.HOME = savedHome
  if (savedUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = savedUserProfile
  vi.restoreAllMocks()
})

describe('walking skeleton: on_agent_finish', () => {
  it('runs each on_agent_finish command in array order on idle settle', async () => {
    const marker = join(homeDir, 'order.txt')
    writeConfig({ on_agent_finish: [`printf 'a' >> '${marker}'`, `printf 'b' >> '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker) && readFileSync(marker, 'utf8') === 'ab')
  })

  it('handler returns without awaiting the child (fire-and-forget)', async () => {
    const marker = join(homeDir, 'async.txt')
    writeConfig({ on_agent_finish: [`sleep 0.5; printf done > '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    const handlers = api.handlers.get('agent_settled') ?? []
    expect(handlers).toHaveLength(1)
    const start = Date.now()
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    expect(Date.now() - start).toBeLessThan(400)
    expect(existsSync(marker)).toBe(false)
    await waitUntil(() => existsSync(marker))
  })

  it('absent config file loads silently and fires nothing', () => {
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).not.toThrow()
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    expect(api.handlers.get('agent_settled')).toHaveLength(1)
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('empty arrays load and stay silent', () => {
    writeConfig({ on_agent_finish: [], on_ask_user: [], extra_ask_user_tool: [] })
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).not.toThrow()
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('commands inherit environment and cwd unchanged', async () => {
    const marker = join(homeDir, 'env.txt')
    process.env.PI_NOTIFY_TEST_SENTINEL = 'sentinel-42'
    try {
      writeConfig({ on_agent_finish: [`pwd > '${marker}'; printenv PI_NOTIFY_TEST_SENTINEL >> '${marker}'`] })
      const api = makeFakeAPI()
      createExtension(api as never)
      emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
      await waitUntil(() => existsSync(marker))
      const lines = readFileSync(marker, 'utf8').trim().split('\n')
      expect(lines[0]).toBe(process.cwd())
      expect(lines[1]).toBe('sentinel-42')
    } finally {
      delete process.env.PI_NOTIFY_TEST_SENTINEL
    }
  })

  it('command stdout/stderr are ignored: a chatty command still completes', async () => {
    const marker = join(homeDir, 'chatty.txt')
    writeConfig({
      on_agent_finish: [`echo chatty-stdout; echo chatty-stderr >&2; printf done > '${marker}'`],
    })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('a settle with isIdle() false fires nothing', async () => {
    const marker = join(homeDir, 'idle-false.txt')
    writeConfig({ on_agent_finish: [`printf x > '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(false))
    await new Promise((r) => setTimeout(r, 300))
    expect(existsSync(marker)).toBe(false)
  })

  it('never subscribes agent_end or session_shutdown', () => {
    writeConfig({ on_agent_finish: [`printf x >> '${join(homeDir, 'never.txt')}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    expect(api.handlers.has('agent_end')).toBe(false)
    expect(api.handlers.has('session_shutdown')).toBe(false)
  })

  it('shell features work through sh -c', async () => {
    const marker = join(homeDir, 'shell.txt')
    writeConfig({ on_agent_finish: [`echo hello-$(echo world) > '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker))
    expect(readFileSync(marker, 'utf8').trim()).toBe('hello-world')
  })
})

describe('config validation (fail-loud)', () => {
  it.each([
    ['syntax error', '{not json,', 'invalid JSON'],
    ['trailing comma', '{"on_agent_finish": [],}', 'invalid JSON'],
    ['non-object root (array)', '[1, 2]', 'must be an object'],
    ['non-object root (string)', '"just a string"', 'must be an object'],
    ['non-object root (number)', '42', 'must be an object'],
    ['non-object root (null)', 'null', 'must be an object'],
    ['non-array on_agent_finish', { on_agent_finish: 'notify_send' }, 'on_agent_finish'],
    ['non-array on_ask_user', { on_ask_user: 'notify_send' }, 'on_ask_user'],
    ['non-array extra_ask_user_tool', { extra_ask_user_tool: 'ask_user_question' }, 'extra_ask_user_tool'],
    ['null field value', { on_agent_finish: null }, 'on_agent_finish'],
    ['numeric entry', { on_agent_finish: [42] }, 'on_agent_finish'],
    ['object entry', { on_agent_finish: [{ command: 'x' }] }, 'on_agent_finish'],
    ['null entry', { on_ask_user: [null] }, 'on_ask_user'],
    ['non-string tool entry', { extra_ask_user_tool: [7] }, 'extra_ask_user_tool'],
    ['unknown key', { on_agent_finishh: [] }, 'on_agent_finishh'],
    ['unknown key alongside valid', { on_agent_finish: [], extra: [] }, 'extra'],
  ])('%s throws naming the file and reason', (_label, body, fragment) => {
    writeConfig(body as never)
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).toThrowError(
      expect.objectContaining({ message: expect.stringContaining('pi-notify.json') }),
    )
    expect(() => createExtension(api as never)).toThrowError(
      expect.objectContaining({ message: expect.stringContaining(fragment) }),
    )
  })

  it('missing fields default to empty arrays', async () => {
    writeConfig({})
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).not.toThrow()
    // An all-default config fires nothing on an idle settle.
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await new Promise((r) => setTimeout(r, 200))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('a failed load subscribes nothing, so pi continues without pi-notify', () => {
    writeConfig('{not json,')
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).toThrow()
    expect(api.handlers.size).toBe(0)
  })

  it('partial configs load: only the configured hook fires', async () => {
    const marker = join(homeDir, 'partial.txt')
    writeConfig({ on_agent_finish: [`printf fired > '${marker}'`] })
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).not.toThrow()
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker))
  })

  it('config is read once at load: later file changes are never reloaded', async () => {
    const markerA = join(homeDir, 'first.txt')
    const markerB = join(homeDir, 'second.txt')
    writeConfig({ on_agent_finish: [`printf a > '${markerA}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    // Rewrite the config after load; the extension must keep the old snapshot.
    writeConfig({ on_agent_finish: [`printf b > '${markerB}'`] })
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(markerA))
    await new Promise((r) => setTimeout(r, 300))
    expect(existsSync(markerB)).toBe(false)
  })

  it('config file is never written by the extension', async () => {
    const marker = join(homeDir, 'readonly.txt')
    writeConfig({ on_agent_finish: [`printf x > '${marker}'`] })
    const configPath = join(homeDir, '.pi', 'pi-notify.json')
    const before = readFileSync(configPath, 'utf8')
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker))
    expect(readFileSync(configPath, 'utf8')).toBe(before)
  })
})

describe('runner edge semantics (#10)', () => {
  it('duplicate commands run once per slot, in position order', async () => {
    const marker = join(homeDir, 'dup.txt')
    writeConfig({ on_agent_finish: [`printf 'x' >> '${marker}'`, `printf 'x' >> '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker) && readFileSync(marker, 'utf8') === 'xx')
  })

  it('empty and whitespace-only entries are skipped with no spawn and no warning', async () => {
    const marker = join(homeDir, 'blank.txt')
    writeConfig({ on_agent_finish: ['', '   ', ' \t\n ', `printf ok > '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(marker))
    await new Promise((r) => setTimeout(r, 200))
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('a spawn-level failure warns with the command and the error, without throwing', async () => {
    const emptyBin = mkdtempSync(join(tmpdir(), 'pi-notify-emptybin-'))
    const savedPath = process.env.PATH
    process.env.PATH = emptyBin
    try {
      writeConfig({ on_agent_finish: [`printf unreachable`] })
      const api = makeFakeAPI()
      createExtension(api as never)
      expect(() => emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))).not.toThrow()
      await waitUntil(() => vi.mocked(console.warn).mock.calls.length > 0)
      const message = String(vi.mocked(console.warn).mock.calls[0]?.[0])
      expect(message).toContain('printf unreachable')
      expect(message).toMatch(/ENOENT|EACCES|\bsh\b/)
    } finally {
      process.env.PATH = savedPath
    }
  })

  it('{title}/{message}/{toolName} literals run unchanged and no env vars are added', async () => {
    const marker = join(homeDir, 'literal.txt')
    const envDump = join(homeDir, 'envdump.txt')
    process.env.PI_NOTIFY_RUNNER_PROBE = 'probe-10'
    try {
      writeConfig({
        on_agent_finish: [
          `printf '%s' '{title} {message} {toolName}' > '${marker}'`,
          `env > '${envDump}'`,
        ],
      })
      const api = makeFakeAPI()
      createExtension(api as never)
      emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
      await waitUntil(() => existsSync(marker) && existsSync(envDump))
      expect(readFileSync(marker, 'utf8')).toBe('{title} {message} {toolName}')
      const envText = readFileSync(envDump, 'utf8')
      expect(envText).toContain('PI_NOTIFY_RUNNER_PROBE=probe-10')
      expect(envText).not.toContain('PI_NOTIFY_COMMAND=')
      expect(envText).not.toContain('NOTIFY_TITLE=')
    } finally {
      delete process.env.PI_NOTIFY_RUNNER_PROBE
    }
  })

  it('a slow first command never delays later commands on the event path', async () => {
    const slow = join(homeDir, 'slow.txt')
    const quick = join(homeDir, 'quick.txt')
    writeConfig({
      on_agent_finish: [`sleep 2; printf done > '${slow}'`, `printf quick > '${quick}'`],
    })
    const api = makeFakeAPI()
    createExtension(api as never)
    const start = Date.now()
    emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))
    await waitUntil(() => existsSync(quick))
    expect(Date.now() - start).toBeLessThan(1500)
    expect(readFileSync(quick, 'utf8')).toBe('quick')
  })

  it('non-zero exits and signals are ignored, later commands still run', async () => {
    const marker = join(homeDir, 'exitcode.txt')
    writeConfig({ on_agent_finish: [`exit 3`, `kill -TERM $$`, `printf survived > '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    expect(() => emit(api, 'agent_settled', { type: 'agent_settled' }, idleCtx(true))).not.toThrow()
    await waitUntil(() => existsSync(marker))
    expect(readFileSync(marker, 'utf8')).toBe('survived')
    expect(console.warn).not.toHaveBeenCalled()
  })
})

describe('native ask-user hook', () => {
  const kinds = ['select', 'confirm', 'input', 'editor', 'custom'] as const

  it.each(kinds)('ui_prompt_start with kind %s runs on_ask_user commands in order', async (kind) => {
    const marker = join(homeDir, `ask-${kind}.txt`)
    writeConfig({ on_ask_user: [`printf 'a' >> '${marker}'`, `printf 'b' >> '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind }, {})
    await waitUntil(() => existsSync(marker) && readFileSync(marker, 'utf8') === 'ab')
  })

  it('two separate waiting spans fire twice', async () => {
    const marker = join(homeDir, 'ask-twice.txt')
    writeConfig({ on_ask_user: [`printf 'x' >> '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'select' }, {})
    await waitUntil(() => existsSync(marker))
    emit(api, 'ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'input' }, {})
    await waitUntil(() => readFileSync(marker, 'utf8') === 'xx')
  })

  it('a coalesced span fires once: one observed start = one fire, end adds nothing', async () => {
    const marker = join(homeDir, 'ask-once.txt')
    writeConfig({ on_ask_user: [`printf 'x' >> '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    // The host coalesces nested/overlapping prompts into a single outer
    // ui_prompt_start; the extension fires once per observed start.
    emit(api, 'ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'select' }, {})
    await waitUntil(() => existsSync(marker))
    emit(api, 'ui_prompt_end', { type: 'ui_prompt_end', reason: 'ui_prompt', kind: 'select' }, {})
    await new Promise((r) => setTimeout(r, 300))
    expect(readFileSync(marker, 'utf8')).toBe('x')
  })

  it('ui_prompt_end is never subscribed and fires nothing', () => {
    writeConfig({ on_ask_user: [`printf x >> '${join(homeDir, 'never-end.txt')}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    expect(api.handlers.has('ui_prompt_end')).toBe(false)
  })

  it('nothing fires when on_ask_user is empty', async () => {
    const marker = join(homeDir, 'ask-empty.txt')
    writeConfig({ on_ask_user: [], on_agent_finish: [`printf x > '${marker}'`] })
    const api = makeFakeAPI()
    createExtension(api as never)
    emit(api, 'ui_prompt_start', { type: 'ui_prompt_start', reason: 'ui_prompt', kind: 'confirm' }, {})
    await new Promise((r) => setTimeout(r, 300))
    expect(existsSync(marker)).toBe(false)
    expect(console.warn).not.toHaveBeenCalled()
  })
})
