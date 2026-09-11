import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

// Opt-in real-pi gate (`npm run test:smoke`). Boots genuine pi in JSON mode
// with pi-notify loaded through `-e`, points its HOME at a temp dir holding a
// temp ~/.pi/pi-notify.json, runs a trivial prompt, and asserts the
// on_agent_finish marker was written by the real `agent_settled` event.
//
// Slow, host/model/credential dependent, so vitest.config.ts keeps this file
// out of the default fast suite (see vitest.smoke.config.ts).

const EXTENSION_PATH = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const PI_BIN = process.env.PI_NOTIFY_SMOKE_PI_BIN ?? 'pi'
const PI_TIMEOUT_MS = Number(process.env.PI_NOTIFY_SMOKE_TIMEOUT_MS ?? 240_000)
const PROVIDER = process.env.PI_NOTIFY_SMOKE_PROVIDER
const MODEL = process.env.PI_NOTIFY_SMOKE_MODEL

// Captured before the child's HOME is redirected, so the smoke run still finds
// the developer's provider credentials and settings.
const REAL_AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent')
const REAL_CONFIG_PATH = join(homedir(), '.pi', 'pi-notify.json')

const FINISH_TOKEN = 'pi-notify-smoke-finished'

let workDir: string | undefined

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true })
})

interface PiRun {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

function runPi(args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<PiRun> {
  return new Promise((resolve) => {
    const child = spawn(PI_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, PI_TIMEOUT_MS)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr, timedOut, spawnError: err.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

// The configured command is spawned detached (fire-and-forget), so give an
// orphaned `sh` a bounded moment to land after pi itself exits.
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

function eventTypes(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return (JSON.parse(line) as { type?: string }).type ?? 'untyped'
      } catch {
        return 'unparseable'
      }
    })
}

describe('smoke: real pi end-to-end', () => {
  it('writes the on_agent_finish marker from a genuine agent_settled event', async () => {
    const realConfigBefore = existsSync(REAL_CONFIG_PATH) ? readFileSync(REAL_CONFIG_PATH, 'utf8') : null

    workDir = mkdtempSync(join(tmpdir(), 'pi-notify-smoke-'))
    const home = join(workDir, 'home')
    const finishMarker = join(workDir, 'finish-marker.txt')
    const askMarker = join(workDir, 'ask-marker.txt')
    mkdirSync(join(home, '.pi'), { recursive: true })
    writeFileSync(
      join(home, '.pi', 'pi-notify.json'),
      JSON.stringify({
        on_agent_finish: [`printf '${FINISH_TOKEN}' > '${finishMarker}'`],
        on_ask_user: [`printf asked > '${askMarker}'`],
        extra_ask_user_tool: ['ask_user_question'],
      }),
    )

    const args = [
      '--mode',
      'json',
      '--no-session',
      '--no-extensions',
      '--no-context-files',
      '-e',
      EXTENSION_PATH,
    ]
    if (PROVIDER) args.push('--provider', PROVIDER)
    if (MODEL) args.push('--model', MODEL)
    args.push('Reply with exactly: ok')

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      PI_CODING_AGENT_DIR: REAL_AGENT_DIR,
      PI_OFFLINE: '1',
      PI_TELEMETRY: '0',
    }

    const result = await runPi(args, env, workDir)
    const diag = [
      `pi (${PI_BIN}) code=${String(result.code)} timedOut=${String(result.timedOut)}`,
      result.spawnError ? `spawn error: ${result.spawnError}` : '',
      `stderr:\n${result.stderr.slice(-4000)}`,
      `stdout:\n${result.stdout.slice(-4000)}`,
    ]
      .filter(Boolean)
      .join('\n')

    await waitFor(() => existsSync(finishMarker), 10_000)

    expect(existsSync(finishMarker), diag).toBe(true)
    expect(readFileSync(finishMarker, 'utf8'), diag).toBe(FINISH_TOKEN)
    expect(result.code, diag).toBe(0)

    const types = eventTypes(result.stdout)
    expect(types, diag).toContain('agent_settled')
    // The finish hook is wired to `agent_settled`, not the intermediate `agent_end`.
    expect(types, diag).toContain('agent_end')

    // Non-interactive hosts have no UI, so the ask paths stay inert.
    expect(existsSync(askMarker), 'ask hook must not fire without a UI').toBe(false)

    const realConfigAfter = existsSync(REAL_CONFIG_PATH) ? readFileSync(REAL_CONFIG_PATH, 'utf8') : null
    expect(realConfigAfter, 'smoke run touched the real ~/.pi/pi-notify.json').toBe(realConfigBefore)
  })
})
