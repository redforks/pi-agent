import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'

const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url))

// The README's copy-paste config is a deliverable, so pin it: extract the
// fenced block and run it through the real validator.
function extractExampleConfig(): string {
  const readme = readFileSync(README_PATH, 'utf8')
  const match = readme.match(/## Example config[\s\S]*?```json\n([\s\S]*?)```/)
  if (!match) throw new Error('README.md: no ```json block under "## Example config"')
  return match[1]
}

describe('README example config', () => {
  it('is the copy-paste example and passes the implemented schema', () => {
    const home = mkdtempSync(join(tmpdir(), 'pi-notify-readme-'))
    mkdirSync(join(home, '.pi'), { recursive: true })
    writeFileSync(join(home, '.pi', 'pi-notify.json'), extractExampleConfig())

    expect(loadConfig(home)).toEqual({
      on_agent_finish: ["notify_send 'pi finished'", 'mpv ~/alert.mp3'],
      on_ask_user: ["notify_send 'pi needs your answer'", "ntfy publish pi 'input needed'"],
      extra_ask_user_tool: ['ask_user_question'],
    })
  })
})
