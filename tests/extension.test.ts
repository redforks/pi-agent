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
    ['non-object root', '[1, 2]', 'must be an object'],
    ['non-array field', { on_agent_finish: 'notify_send' }, 'on_agent_finish'],
    ['non-string entry', { on_agent_finish: [42] }, 'on_agent_finish'],
    ['unknown key', { on_agent_finishh: [] }, 'on_agent_finishh'],
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

  it('missing fields default to empty arrays', () => {
    writeConfig({})
    const api = makeFakeAPI()
    expect(() => createExtension(api as never)).not.toThrow()
  })
})
