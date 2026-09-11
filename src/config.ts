import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface PiNotifyConfig {
  on_agent_finish: string[]
  on_ask_user: string[]
  extra_ask_user_tool: string[]
}

const CONFIG_RELATIVE_PATH = join('.pi', 'pi-notify.json')

const KNOWN_KEYS: (keyof PiNotifyConfig)[] = ['on_agent_finish', 'on_ask_user', 'extra_ask_user_tool']

function resolveHomeDir(explicitHomeDir?: string): string {
  if (explicitHomeDir !== undefined) return explicitHomeDir
  const home = process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME
  if (!home) throw new Error('pi-notify: cannot resolve home directory (no HOME set)')
  return home
}

export function configFilePath(homeDir?: string): string {
  return join(resolveHomeDir(homeDir), CONFIG_RELATIVE_PATH)
}

function emptyConfig(): PiNotifyConfig {
  return { on_agent_finish: [], on_ask_user: [], extra_ask_user_tool: [] }
}

/**
 * Read and validate ~/.pi/pi-notify.json exactly once per call.
 * Absent file -> all three arrays empty, silent no-op.
 * Present-but-invalid -> throw naming the file and the reason.
 */
export function loadConfig(homeDir?: string): PiNotifyConfig {
  const path = configFilePath(homeDir)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyConfig()
    throw new Error(`pi-notify: ${path}: cannot read config: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`pi-notify: ${path}: invalid JSON: ${(err as Error).message}`)
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`pi-notify: ${path}: top-level value must be an object`)
  }

  const record = parsed as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(KNOWN_KEYS as string[]).includes(key)) {
      throw new Error(`pi-notify: ${path}: unknown key "${key}"`)
    }
  }

  const config = emptyConfig()
  for (const key of KNOWN_KEYS) {
    const value = record[key]
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      throw new Error(`pi-notify: ${path}: "${key}" must be an array`)
    }
    for (const entry of value) {
      if (typeof entry !== 'string') {
        throw new Error(
          `pi-notify: ${path}: "${key}" entries must be strings, got ${JSON.stringify(entry)}`,
        )
      }
    }
    config[key] = [...value] as string[]
  }
  return config
}
