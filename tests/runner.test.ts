import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The runner owns the single global FIFO (ticket #13). These tests drive it
// directly with a stubbed spawn so spawn order is observed exactly, without
// racing real shell startup.
const harness = vi.hoisted(() => ({
  spawned: [] as { command: string; args: string[] }[],
  failAt: null as number | null, // synchronous throw on the Nth spawn
  errorAt: null as number | null, // async 'error' event on the Nth child
}))

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[]) => {
    const index = harness.spawned.length + 1
    harness.spawned.push({ command, args })
    if (harness.failAt !== null && index === harness.failAt) {
      throw new Error('stub spawn failure')
    }
    return {
      on: (event: string, cb: (err: Error) => void) => {
        if (event === 'error' && harness.errorAt !== null && index === harness.errorAt) {
          queueMicrotask(() => cb(new Error('stub async spawn error')))
        }
      },
      unref: () => {},
    }
  },
}))

import { runCommands } from '../src/runner.js'

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function shellCommands(): string[] {
  return harness.spawned.map((call) => call.args[1] as string)
}

describe('runner global FIFO (#13)', () => {
  beforeEach(() => {
    harness.spawned.length = 0
    harness.failAt = null
    harness.errorAt = null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enqueues a hook list for the drain instead of spawning inline', async () => {
    runCommands(['one'])
    expect(harness.spawned).toEqual([])
    await flush()
    expect(shellCommands()).toEqual(['one'])
  })

  it('initiates one hook list in array order', async () => {
    runCommands(['one', 'two', 'three'])
    await flush()
    expect(shellCommands()).toEqual(['one', 'two', 'three'])
  })

  it('keeps every entry of an earlier hook ahead of a later hook', async () => {
    runCommands(['a1', 'a2'])
    runCommands(['b1'])
    await flush()
    expect(shellCommands()).toEqual(['a1', 'a2', 'b1'])
  })

  it('keeps observed order when a settle precedes a later ask', async () => {
    runCommands(['finish1', 'finish2'])
    runCommands(['ask1'])
    await flush()
    expect(shellCommands()).toEqual(['finish1', 'finish2', 'ask1'])
  })

  it('preserves FIFO across separate event-loop turns', async () => {
    runCommands(['first'])
    await flush()
    runCommands(['second'])
    await flush()
    expect(shellCommands()).toEqual(['first', 'second'])
  })

  it('skips empty and whitespace-only entries without spawning', async () => {
    runCommands(['', '   ', ' \t\n '])
    await flush()
    expect(harness.spawned).toEqual([])
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('runs each entry as sh -c', async () => {
    runCommands(['echo hi | wc -c'])
    await flush()
    expect(harness.spawned).toEqual([{ command: 'sh', args: ['-c', 'echo hi | wc -c'] }])
  })

  it('a spawn failure warns and never stops the rest of the queue', async () => {
    harness.failAt = 2
    runCommands(['a', 'b', 'c'])
    await flush()
    expect(shellCommands()).toEqual(['a', 'b', 'c'])
    expect(vi.mocked(console.warn).mock.calls).toHaveLength(1)
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain('b')
  })

  it('an async spawn error (ENOENT-style) warns and never stops the rest of the queue', async () => {
    harness.errorAt = 1
    runCommands(['a', 'b'])
    await flush()
    expect(shellCommands()).toEqual(['a', 'b'])
    expect(vi.mocked(console.warn).mock.calls).toHaveLength(1)
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain('a')
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toMatch(/error/i)
  })
})
