import { spawn } from 'node:child_process'

/**
 * Run a literal list of shell commands in array order, fire-and-forget.
 *
 * Each entry runs as `sh -c <entry>` with stdio ignored and the host
 * environment/cwd inherited unchanged. No interpolation, no added env vars,
 * no timeout, no kill, no reaping: the handler enqueues every spawn and
 * returns without awaiting any child.
 *
 * Empty and whitespace-only entries are skipped silently. A spawn-level
 * failure (missing `sh`, EACCES, bad cwd) warns with the command and the
 * error and never throws. Post-spawn exit codes and signals are not observed.
 */
export function runCommands(commands: string[]): void {
  for (const command of commands) {
    if (command.trim() === '') continue
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('sh', ['-c', command], { stdio: 'ignore' })
    } catch (err) {
      console.warn(`pi-notify: failed to spawn ${JSON.stringify(command)}: ${(err as Error).message}`)
      continue
    }
    // Async spawn errors (ENOENT, EACCES, bad cwd) surface here, not via
    // throw. Warn with the command and keep the hook path non-fatal.
    child.on('error', (err) => {
      console.warn(`pi-notify: failed to spawn ${JSON.stringify(command)}: ${err.message}`)
    })
    // Intentionally unref'd from the handler's perspective: no wait, no
    // reaping, no exit-code handling. Keep the child alive past handler
    // return without holding the event loop open on its behalf.
    child.unref?.()
  }
}
