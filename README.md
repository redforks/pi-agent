# pi-notify

A pi extension that runs shell commands when pi **finishes** or **asks you something**, so you can wire your own notifier (`notify_send`, `mpv`, `ntfy`, a terminal bell) and walk away from the machine.

Observer-only: it never blocks a tool call, never returns a block decision, never mutates event input, and never invents placeholders or environment variables.

## What the two hooks mean

| Hook | Fires when | Subscribed event |
| --- | --- | --- |
| `on_agent_finish` | pi has **actually settled** — idle, nothing queued, no auto-retry or auto-compact still pending. Never the intermediate `agent_end`. | `agent_settled`, and only while `ctx.isIdle()` is true |
| `on_ask_user` | pi is **waiting on you** — once per native prompt (`select`, `confirm`, `input`, `editor`, `custom`), and at call-start for every tool call whose exact name is in `extra_ask_user_tool`. | `ui_prompt_start` (the host's coalesced outer waiting span, so nested/overlapping prompts notify once) and `tool_call` |

`on_agent_finish` still fires in non-interactive mode; the ask paths are inert there (see [Non-interactive mode](#non-interactive-mode)).

## Config

Read once at extension load from `~/.pi/pi-notify.json` (`$HOME`, or `%USERPROFILE%` on Windows, joined with `.pi/pi-notify.json`). Never written, never watched, never hot-reloaded. A missing file means all three arrays are empty and pi-notify is a silent no-op.

Three arrays, all optional, strings only:

### `on_agent_finish` and `on_ask_user` — shell command lists

Each entry is one shell string, run through `sh -c`, in array order, fire-and-forget:

- Inherits your environment and cwd unchanged, so `notify_send`, `mpv` and `ntfy` resolve from the same `PATH` pi already had.
- Real shell strings: pipes, `$(...)`, `>>`, quoting and `&&` all work as written.
- **No interpolation**: no `{title}` / `{message}` / `{toolName}` placeholders and no injected environment variables. What you wrote is literally what runs.
- stdout/stderr are ignored; no timeout, no kill, no wait, no reaping. A slow or hung notifier can never stall pi.
- Duplicate entries run once per slot. Blank or whitespace-only entries are skipped silently.
- A spawn-level failure (missing `sh`, `EACCES`, bad cwd) warns with the command and the error; a non-zero exit or signal from your notifier is never observed.

### `extra_ask_user_tool` — tool names

Exact tool identifiers, matched as **exact, case-sensitive, whole-string set membership**: `ask_user_question` matches; `Ask_User_Question` and `ask-user-question` do not. Duplicate entries do not multiply fires. The ask notification fires at call-start, before the tool executes, one notification per ask.

### Overlap

A coincident ask and finish fire **both** hooks, ask first: each event enqueues its commands when observed, and one global FIFO spawns them in that order. Neither hook suppresses the other.

## Example config

Copy-paste into `~/.pi/pi-notify.json`:

```json
{
  "on_agent_finish": ["notify_send 'pi finished'", "mpv ~/alert.mp3"],
  "on_ask_user": ["notify_send 'pi needs your answer'", "ntfy publish pi 'input needed'"],
  "extra_ask_user_tool": ["ask_user_question"]
}
```

Any field you leave out defaults to `[]`, so you can configure only the hook you care about today.

## Fail-loud config contract

A present-but-invalid config throws from the extension factory, naming the file and the reason; pi continues without pi-notify. It never half-works, and there is no warn-and-default fallback or coercion. Rejected:

- invalid JSON (a trailing comma is reported as such);
- a top-level value that is not an object (array root, scalar root);
- a present field that is not an array (`"on_agent_finish": "notify_send"` is caught, not coerced);
- an array entry that is not a string;
- an unknown top-level key — `on_agent_finishh` fails loudly instead of silently never firing.

## Non-interactive mode

In `--print` / `--mode json` (`ctx.hasUI === false`):

- `on_agent_finish` **still fires**, because `agent_settled` still happens.
- The ask paths are **inert**: native prompts do not occur, and an ask tool such as rpiv's `ask_user_question` is stripped from the active tool list when there is no UI, so no `tool_call` occurs.

This is expected degradation, not a bug. pi-notify never polls or works around it.

## Subagents

When `PI_SUBAGENT_CHILD` is `"1"` (processes hosting pi-subagents child
sessions), pi-notify stays fully inert: it returns before reading
`~/.pi/pi-notify.json` or subscribing to any event, so neither hook fires
and a present-but-invalid config stays silent. `PI_SUBAGENT_PARENT_SESSION`
is ignored — the root session sets it too. Subagents outside pi-subagents are
out of scope.

## Load it

- Quick test: `pi -e /path/to/pi-notify/src/index.ts`
- Auto-discovery: place it under `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local, once the project is trusted).

## Development

- `npm test` — the fast suite (fake-host seam: config validation, event mapping, runner semantics).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run test:smoke` — the opt-in real-pi gate. It boots genuine pi (`--mode json`) with pi-notify loaded via `-e`, a temp `HOME` and a temp `~/.pi/pi-notify.json`, runs a trivial prompt, and asserts the `on_agent_finish` marker file was written by a real `agent_settled` event. It is slow and depends on your host, model and credentials, so it is excluded from `npm test`.

  Overridable via environment: `PI_NOTIFY_SMOKE_PI_BIN` (default `pi`), `PI_NOTIFY_SMOKE_PROVIDER` / `PI_NOTIFY_SMOKE_MODEL` (default: your pi defaults), `PI_NOTIFY_SMOKE_TIMEOUT_MS` (default 240000). It never reads or writes your real `~/.pi/pi-notify.json`.
