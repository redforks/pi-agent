import { spawn } from 'node:child_process'

/**
 * pi-notify's single global FIFO (ticket #13).
 *
 * Every hook handler calls `runCommands`, which appends its non-blank entries
 * to one process-wide queue in array order and returns immediately. A single
 * drain — scheduled once per burst — initiates the queued entries in FIFO
 * order. Enqueue order, never per-hook timing, fixes spawn order, and because
 * a hook's whole list lands in the queue as one synchronous batch, a later
 * hook's commands can never be spawned between an earlier hook's commands.
 *
 * Each entry runs as `sh -c <entry>` with stdio ignored and the host
 * environment/cwd inherited unchanged. No interpolation, no added env vars,
 * no timeout, no kill, no reaping: the drain issues every spawn and returns
 * without awaiting any child.
 *
 * Empty and whitespace-only entries are skipped silently. A spawn-level
 * failure (missing `sh`, EACCES, bad cwd) warns with the command and the
 * error and never throws. Post-spawn exit codes and signals are not observed.
 */
const pendingCommands: string[] = []
let drainScheduled = false

export function runCommands(commands: string[]): void {
  for (const command of commands) {
    if (command.trim() === '') continue
    pendingCommands.push(command)
  }
  if (drainScheduled) return
  drainScheduled = true
  queueMicrotask(drain)
}

function drain(): void {
  try {
    while (pendingCommands.length > 0) {
      const command = pendingCommands.shift()
      if (command === undefined) break // queue drained or emptied concurrently
      spawnCommand(command)
    }
  } finally {
    drainScheduled = false
  }
}

function spawnCommand(command: string): void {
  let child: ReturnType<typeof spawn>
  try {
    child = spawn('sh', ['-c', command], { stdio: 'ignore' })
  } catch (err) {
    console.warn(`pi-notify: failed to spawn ${JSON.stringify(command)}: ${(err as Error).message}`)
    return
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
