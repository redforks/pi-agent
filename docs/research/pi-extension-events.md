# Research: Pi extension events and config conventions

Source: resolution of ticket "Pi extension events and config conventions" (map: pi-notify extension spec).
Method: inspect-only review of this repo (greenfield: `AGENTS.md` + `docs/agents/*.md` only; no extension source) plus conversation context. No pi core source, no pi docs, and no network were available at research time. Everything below that depends on pi runtime behaviour is flagged **UNVERIFIED** where it could not be checked in-repo. A follow-up verification task must confirm each identifier against `https://pi.dev/docs/latest/extensions` and the `ExtensionAPI` types before implementation.

## Facts

### F1. Repo state (verified in-repo)

- Repo contains only `AGENTS.md`, `docs/agents/*.md`, `.gitignore` (`.pi/tasks/`), `.git/`. No extension code, no config schema, no `CONTEXT.md`, no ADRs.
- A repo-wide grep for `agent_settled|agent_end|ui_prompt|tool_call|tool_execution|ExtensionAPI|settings\.json|spawn|sh -c` returned zero hits in project files. No hook name, payload field, config path, or spawn convention can be verified from the repo alone.

### F2. Hook names and payloads (per conversation context; UNVERIFIED against pi source)

- Extensions are TypeScript modules receiving `ExtensionAPI`.
- `agent_end` fires after each low-level run; pi may still auto-retry / compact / continue afterwards. **Do not use for `on_agent_finish`.**
- `agent_settled` fires when pi goes idle; `ctx.isIdle()` is true. **Standing preference: `on_agent_finish` maps here.** UNVERIFIED: exact spelling, `isIdle()` context, accompanying payload.
- `ui_prompt_start` / `ui_prompt_end` fire around `ctx.ui.select / confirm / input / editor / custom` with kinds `select|confirm|input|editor|custom`. **Standing preference: `on_ask_user` covers these native prompts.** UNVERIFIED: exact event names, kind field name, `custom` identifiability.
- `tool_call` fires per tool call and can block. `tool_execution_start` / `tool_execution_end` carry `toolCallId / toolName / args / result`. **Third-party ask-user detection uses exact-name matching on the tool-name field.** UNVERIFIED: exact names/fields, blocking contract, start-vs-call timing.

### F3. Config-file conventions (per conversation context; UNVERIFIED against pi source)

- Precedent `~/.config/rpiv-ask-user-question/config.json`: read-never-written; malformed JSON falls back to defaults with a warning.
- Planned config: JSON file under `~/.pi` with three arrays — `on_agent_finish`, `on_ask_user` (shell-string commands), `extra_ask_user_tool` (tool names). UNVERIFIED: exact filename, lookup order / env overrides, precedence vs pi `settings.json`, caching / hot-reload, schema validation.

### F4. Shell-command spawning (no in-repo evidence; UNVERIFIED)

- Planned: `on_agent_finish` / `on_ask_user` entries are shell strings (e.g. `notify_send`, `mpv`, `ntfy`). UNVERIFIED: `sh -c` mandate, sequential vs parallel, awaited vs fire-and-forget, timeout/kill, stdio handling, env, failure semantics, quoting rules.

## Open questions (for spec + verification task)

1. Canonical `ExtensionAPI` event-registration names and signatures.
2. Exact payload fields (`kind`? `toolName`? `agent_settled` payload?).
3. Should `on_agent_finish` also defensively gate on `ctx.isIdle()`?
4. Should `on_ask_user` fire on `ui_prompt_start`, `ui_prompt_end`, or both?
5. Blocking vs observation-only hook for third-party tool matching.
6. Config path, precedence, caching, reload.
7. Malformed-config contract (warn where? fail open or closed? coerce?).
8. Spawn contract (timeout, continue-on-error, env, cwd, output, quoting).

## Suggested spec citations (all TO-VERIFY)

```ts
// TO-VERIFY against pi ExtensionAPI source/docs.
events.on('agent_settled', (ctx) => { /* ctx.isIdle() === true */ });
events.on('agent_end', (ctx) => { /* per-run only; must NOT trigger on_agent_finish */ });
events.on('ui_prompt_start', (payload) => { /* payload.kind: 'select'|'confirm'|'input'|'editor'|'custom' */ });
events.on('ui_prompt_end', (payload) => { /* same kind field; decide start-vs-end */ });
events.on('tool_call', (payload) => { /* payload.toolName; may block — confirm contract */ });
events.on('tool_execution_start', (payload) => { /* payload.toolCallId, payload.toolName, payload.args */ });
events.on('tool_execution_end', (payload) => { /* + payload.result */ });
```

```jsonc
// TO-VERIFY: exact filename under ~/.pi.
// ~/.pi/<name>.json — read-never-written; malformed JSON => defaults + warning.
{
  "on_agent_finish": ["notify_send 'agent finished'", "mpv alert.mp3"],
  "on_ask_user": ["notify_send 'input needed'"],
  "extra_ask_user_tool": ["ask_user_question"]
}
```

```ts
// TO-VERIFY spawn contract.
// Suggested: sequential `sh -c` per entry, awaited with timeout, continue-on-error,
// stdout/stderr ignored (or debug-logged); fire-and-forget only as explicit opt-in.
for (const cmd of config.on_agent_finish) await spawn('sh', ['-c', cmd], { timeout: 15000 });
```

## Verification checklist (for the follow-up verification task)

Needs network / pi checkout: open `https://pi.dev/docs/latest/extensions`, the pi repo's `ExtensionAPI` / events type definitions, and the installed `@juicesharp/rpiv-ask-user-question` source; confirm each name/field above and correct the spec citations before build.
